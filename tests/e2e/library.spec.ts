import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MAX_UPLOAD_BYTES } from '../../src/lib/types';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SAMPLE_PDF = 'tests/fixtures/sample.pdf';
const SAMPLE_EPUB = 'tests/fixtures/sample.epub';

let tmp: string;
test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hmr-'));
});
test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test.beforeEach(async ({ page }) => {
  // clean slate: remove books left by earlier runs
  const res = await page.request.get('/api/books');
  const { books } = (await res.json()) as { books: { id: string }[] };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
  await page.goto('/library');
  await expect(page.getByText('No books yet')).toBeVisible(); // library has loaded
});

function bookRequests(page: import('@playwright/test').Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}
/** Delete sits in the ⋯ menu under the book's cover. */
async function askDelete(row: import('@playwright/test').Locator) {
  await row.getByRole('button', { name: 'Options for Sample Book' }).click();
  await row.getByRole('button', { name: 'Delete Sample Book' }).click();
}

const touchesBooksOrStorage = (urls: string[]) =>
  urls.filter((u) => u.includes('/api/books') || u.includes('/storage/'));

test('uploading a PDF shows it with its title and author, and it can be deleted', async ({
  page,
}) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Test Author');

  // Delete asks first; Cancel keeps the book.
  await askDelete(row);
  await expect(row).toContainText('Delete this book with its highlights, threads and notes?');
  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByRole('button', { name: 'Yes, delete' })).toHaveCount(0);
  await page.reload();
  await expect(row).toBeVisible();

  await askDelete(row);
  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE');
  await row.getByRole('button', { name: 'Yes, delete' }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Book' })).toHaveCount(0);
});

test('a library refresh in flight when a book is deleted does not bring it back', async ({
  page,
}) => {
  // Hold the list refresh that follows text preparation: its answer is read before the delete
  // and delivered after it, as a slow response would be.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => (markHeld = resolve));
  await page.route('**/api/books', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const { books } = (await response.json()) as { books: { extracted: boolean }[] };
    if (books.some((b) => b.extracted)) {
      markHeld();
      await released;
    }
    await route.fulfill({ response });
  });

  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await held;

  await askDelete(row);
  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE');
  await row.getByRole('button', { name: 'Yes, delete' }).click();
  expect((await deleted).status()).toBe(204);
  await expect(row).toHaveCount(0);

  const stale = page.waitForResponse(
    (r) => r.url().endsWith('/api/books') && r.request().method() === 'GET',
  );
  release();
  await stale;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(row).toHaveCount(0, { timeout: 500 });
});

test('uploading an EPUB reads its title and author', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_EPUB);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Test Author');
});

test('a file over 50 MB is refused before any request', async ({ page }) => {
  const urls = bookRequests(page);
  const big = join(tmp, 'huge.pdf');
  const buf = Buffer.alloc(MAX_UPLOAD_BYTES + 1024 * 1024);
  buf.write('%PDF-1.4\n');
  writeFileSync(big, buf);

  await page.getByLabel('Choose a book').setInputFiles(big);
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This file is larger than 50 MB, the current limit.' }),
  ).toBeVisible();
  expect(touchesBooksOrStorage(urls)).toEqual([]);
});

test('a text file renamed to .pdf is refused', async ({ page }) => {
  const urls = bookRequests(page);
  const fake = join(tmp, 'fake.pdf');
  writeFileSync(fake, 'just some text, not a pdf');

  await page.getByLabel('Choose a book').setInputFiles(fake);
  await expect(
    page.getByRole('alert').filter({ hasText: "This file doesn't look like a real PDF or EPUB." }),
  ).toBeVisible();
  expect(touchesBooksOrStorage(urls)).toEqual([]);
});

test('an unsupported extension is refused', async ({ page }) => {
  const mobi = join(tmp, 'a.mobi');
  writeFileSync(mobi, 'BOOKMOBI');
  await page.getByLabel('Choose a book').setInputFiles(mobi);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Only PDF and EPUB files are supported.' }),
  ).toBeVisible();
});

test('the library has no horizontal scroll', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Book' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('a dropped upload leaves no orphan book behind', async ({ page }) => {
  await page.route('**/storage/v1/object/upload/**', (route) => route.abort());
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  await expect(
    page.getByRole('alert').filter({ hasText: 'The upload failed. Please try again.' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  const { books } = (await (await page.request.get('/api/books')).json()) as { books: unknown[] };
  expect(books).toEqual([]);
});

test('a failed delete shows an error and keeps the row', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await page.route('**/api/books/*', (route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ status: 500 }) : route.continue(),
  );
  await askDelete(row);
  await row.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not delete this book. Please try again.' }),
  ).toBeVisible();
  await expect(row).toBeVisible();
});

test('a failed library load shows an error', async ({ page }) => {
  await page.route('**/api/books', (route) => route.fulfill({ status: 500 }));
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not load your library.' }),
  ).toBeVisible();
});

test('a book not opened yet shows its format and "New", with no Continue reading', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toContainText('PDF · New', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Continue reading' })).toHaveCount(0);
});

test('the reading progress saved in the reader shows in the library', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toContainText('PDF · New', { timeout: 30_000 });

  await row.getByRole('link', { name: 'Sample Book' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  const saved = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().endsWith('/position') && r.postDataJSON().page === 2,
  );
  await page.getByRole('button', { name: 'Next page' }).click();
  const { progress } = (await saved).postDataJSON() as { progress: number };
  const shown = await page.getByRole('progressbar', { name: 'Reading progress' }).getAttribute('aria-valuenow');
  expect(Math.round(progress * 100)).toBe(Number(shown));
  expect(progress).toBeGreaterThan(0);

  await page.goto('/library');
  await expect(row).toContainText(`PDF · ${shown}%`);
  const continuing = page.getByRole('region', { name: 'Continue reading' });
  await expect(continuing).toContainText('Sample Book');
  await expect(continuing.getByRole('progressbar', { name: 'Reading progress' })).toHaveAttribute(
    'aria-valuenow',
    shown!,
  );
  // A PDF without bookmarks has no chapter to add to the author.
  await expect(continuing.locator('p', { hasText: /^Test Author$/ })).toBeVisible();
  await continuing.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('2');
});

/** A book stored from a fixture with contents (see tests/fixtures/make-fixtures.ts), without the library UI. */
async function addContentsBook(page: Page, fixture: 'contents.pdf' | 'contents.epub', author: string | null) {
  const format = fixture.endsWith('.pdf') ? 'pdf' : 'epub';
  const created = await page.request.post('/api/books', {
    data: { title: 'Contents Book', author, format, sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as { bookId: string; signedUploadUrl: string };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': format === 'pdf' ? 'application/pdf' : 'application/epub+zip' },
    body: readFileSync(`tests/fixtures/${fixture}`),
  });
  expect(put.ok).toBe(true);
  return bookId;
}

/** Opens the book, goes to Chapter 3 through the contents (inside `volume`), and waits for it to be saved. */
async function readChapterThree(page: Page, bookId: string, volume: string) {
  await page.goto(`/read/${bookId}`);
  const button = page.getByRole('button', { name: 'Contents' });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const contents = page.getByRole('navigation', { name: 'Contents' });
  await contents.getByRole('button', { name: volume, exact: true }).click();
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' &&
      r.url().endsWith(`/api/books/${bookId}/position`) &&
      r.request().postDataJSON().chapter === 'Chapter 3',
  );
  await contents.getByRole('button', { name: 'Chapter 3' }).click();
  expect((await saved).status()).toBe(204);
}

test('a PDF read to a chapter shows "Author · Chapter" on the Continue reading card', async ({ page }) => {
  const bookId = await addContentsBook(page, 'contents.pdf', 'Test Author');
  await readChapterThree(page, bookId, 'Part Two');

  await page.goto('/library');
  const continuing = page.getByRole('region', { name: 'Continue reading' });
  await expect(continuing.getByText('Test Author · Chapter 3')).toBeVisible();
});

test('an EPUB read to a chapter shows the chapter alone when the book has no author', async ({ page }) => {
  const bookId = await addContentsBook(page, 'contents.epub', null);
  await readChapterThree(page, bookId, 'Volume II');

  await page.goto('/library');
  const continuing = page.getByRole('region', { name: 'Continue reading' });
  await expect(continuing.getByText('Chapter 3', { exact: true })).toBeVisible();
});

test('the ⋯ menu closes with Escape and gives focus back', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  const options = row.getByRole('button', { name: 'Options for Sample Book' });
  await options.click();
  await expect(options).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByRole('button', { name: 'Delete Sample Book' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'Delete Sample Book' })).toHaveCount(0);
  await expect(options).toBeFocused();
});
