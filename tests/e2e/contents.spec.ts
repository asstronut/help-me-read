import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

/**
 * A book stored from a fixture, without going through the library UI. contents.epub and
 * contents.pdf have two-level contents (see tests/fixtures/make-fixtures.ts); sample.pdf has none.
 */
async function addBook(
  page: Page,
  fixture: 'contents.epub' | 'contents.pdf' | 'sample.pdf',
): Promise<string> {
  const format = fixture.endsWith('.pdf') ? 'pdf' : 'epub';
  const created = await page.request.post('/api/books', {
    data: { title: 'Contents Book', author: null, format, sizeBytes: 100 },
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

const contents = (page: Page) => page.getByRole('navigation', { name: 'Contents' });
const title = (page: Page) => page.getByRole('banner');

/** The contents list, opened from its ☰ button if it isn't open. */
async function openContents(page: Page) {
  const button = page.getByRole('button', { name: 'Contents' });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** The heading of the chapter foliate is showing. */
const chapterHeading = (page: Page) =>
  Promise.all(
    page
      .frames()
      .filter((f) => f !== page.mainFrame() && f.url() !== 'about:blank')
      .map((f) => f.evaluate(() => document.querySelector('h1')?.textContent ?? '').catch(() => '')),
  ).then((headings) => headings.join());

test('an EPUB lists its contents in two levels, marks the current chapter and goes to another', async ({
  page,
}) => {
  const bookId = await addBook(page, 'contents.epub');
  await page.goto(`/read/${bookId}`);
  await openContents(page);

  // The volume with the current chapter is open; the other is closed.
  const volumeOne = contents(page).getByRole('button', { name: 'Volume I', exact: true });
  const volumeTwo = contents(page).getByRole('button', { name: 'Volume II' });
  await expect(volumeOne).toHaveAttribute('aria-expanded', 'true');
  await expect(volumeTwo).toHaveAttribute('aria-expanded', 'false');
  await expect(contents(page).getByRole('button', { name: 'Chapter 1' })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await expect(contents(page).getByRole('button', { name: 'Chapter 2' })).not.toHaveAttribute(
    'aria-current',
    /.*/,
  );
  await expect(contents(page).getByRole('button', { name: 'Chapter 3' })).toHaveCount(0);
  await expect(title(page)).toContainText('Chapter 1');

  await volumeTwo.click();
  await contents(page).getByRole('button', { name: 'Chapter 3' }).click();
  await expect.poll(() => chapterHeading(page)).toContain('Chapter 3');
  await expect(title(page)).toContainText('Chapter 3');

  await openContents(page);
  await expect(contents(page).getByRole('button', { name: 'Chapter 3' })).toHaveAttribute(
    'aria-current',
    'location',
  );
});

test('a PDF lists its bookmarks, goes to their pages and follows the page', async ({ page }) => {
  const bookId = await addBook(page, 'contents.pdf');
  await page.goto(`/read/${bookId}`);
  await openContents(page);

  await expect(contents(page).getByRole('button', { name: 'Part One' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(contents(page).getByRole('button', { name: 'Chapter 1' })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await expect(title(page)).toContainText('Chapter 1');

  await contents(page).getByRole('button', { name: 'Part Two' }).click();
  await contents(page).getByRole('button', { name: 'Chapter 3' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('5');
  await expect(title(page)).toContainText('Chapter 3');

  // Paging back into chapter 2 (pages 3–4) moves the mark there.
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('4');
  await expect(title(page)).toContainText('Chapter 2');
  await openContents(page);
  await expect(contents(page).getByRole('button', { name: 'Chapter 2' })).toHaveAttribute(
    'aria-current',
    'location',
  );
});

test('a PDF without bookmarks says so', async ({ page }) => {
  const bookId = await addBook(page, 'sample.pdf');
  await page.goto(`/read/${bookId}`);
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  await openContents(page);
  await expect(contents(page)).toContainText('No contents in this PDF');
  await expect(title(page)).not.toContainText('·');
});

/** The chapter ticks under the ☰ button (hidden from screen readers, so found by their data attributes). */
const ticks = (page: Page) => page.locator('[data-contents-ticks] [data-tick]');
const tickName = (page: Page) => page.locator('[data-contents-tick-name]');

test('beside the book a tick stands for each chapter: hover names it, a click goes there', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the ticks are for a mouse beside the book');
  const bookId = await addBook(page, 'contents.pdf');
  await page.goto(`/read/${bookId}`);
  const button = page.getByRole('button', { name: 'Contents' });
  // The list starts closed; the ticks show the three chapters, the first one current.
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(ticks(page)).toHaveCount(3);
  await expect(ticks(page).nth(0).locator('[data-current]')).toHaveCount(1);

  await ticks(page).nth(2).hover();
  await expect(tickName(page)).toHaveText('Part Two › Chapter 3');
  await ticks(page).nth(2).click();
  await expect(page.getByLabel('Page number')).toHaveValue('5');
  await expect(ticks(page).nth(2).locator('[data-current]')).toHaveCount(1);

  await page.mouse.move(640, 400);
  await expect(tickName(page)).toHaveCount(0);
});

test('a side panel leaves the contents rail as it is', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the rail is beside the book');
  const bookId = await addBook(page, 'contents.pdf');
  await page.goto(`/read/${bookId}`);
  const rail = contents(page);
  await expect(ticks(page)).toHaveCount(3);
  const before = await rail.boundingBox();

  await page.getByRole('button', { name: 'Highlights and threads' }).click();
  await expect(page.getByRole('complementary', { name: 'In this book' })).toBeVisible();
  expect(await rail.boundingBox()).toEqual(before);
  await expect(ticks(page)).toHaveCount(3);
  // The ☰ button still opens the list, and choosing closes it.
  await page.getByRole('button', { name: 'Contents' }).click();
  await contents(page).getByRole('button', { name: 'Chapter 2' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('3');
  await expect(contents(page).getByRole('button', { name: 'Chapter 1' })).toBeHidden();
});
