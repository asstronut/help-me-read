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

/** The contents list, opened from its ☰ button if it isn't open (it is open beside the book on a wide desktop). */
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

test('on a wide window the contents stay open beside the book, and fold to ☰ when there is no room', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the rail is for wide windows');
  const bookId = await addBook(page, 'contents.pdf');
  await page.goto(`/read/${bookId}`);
  const button = page.getByRole('button', { name: 'Contents' });
  const chapterOne = contents(page).getByRole('button', { name: 'Chapter 1' });
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(chapterOne).toBeVisible();

  // The rail stays open after a jump, and the button folds it.
  await contents(page).getByRole('button', { name: 'Chapter 2' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('3');
  await expect(chapterOne).toBeVisible();
  await button.click();
  await expect(chapterOne).toBeHidden();
  await button.click();
  await expect(chapterOne).toBeVisible();

  // A narrower window has no room for it: the rail folds to ☰, which opens the list over the book.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(chapterOne).toBeHidden();
  await button.click();
  await chapterOne.click();
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  // Choosing closes the list over the book.
  await expect(chapterOne).toBeHidden();
});

test('a side panel takes the room on the right: the contents fold to ☰ while it is open', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the rail is for wide windows');
  const bookId = await addBook(page, 'contents.pdf');
  await page.goto(`/read/${bookId}`);
  const button = page.getByRole('button', { name: 'Contents' });
  const chapterOne = contents(page).getByRole('button', { name: 'Chapter 1' });
  await expect(chapterOne).toBeVisible();

  await page.getByRole('button', { name: 'Highlights and threads' }).click();
  await expect(page.getByRole('complementary', { name: 'In this book' })).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(chapterOne).toBeHidden();
  // The ☰ button still opens the list, over the book.
  await button.click();
  await contents(page).getByRole('button', { name: 'Chapter 2' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('3');
  await expect(chapterOne).toBeHidden();

  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(chapterOne).toBeVisible();
});
