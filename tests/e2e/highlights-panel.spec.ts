import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

// The contents books (tests/fixtures/make-fixtures.ts): the PDF's bookmarks are Chapter 1 (pages 1–2),
// Chapter 2 (3–4) and Chapter 3 (5–6); the EPUB's chapters are its spine items ch1–ch3.
const PDF_SEGMENTS = Array.from({ length: 6 }, (_, i) => ({
  seq: i,
  label: `Page ${i + 1}`,
  paragraphs: [
    `Chapter ${[1, 1, 2, 2, 3, 3][i]}, page ${i + 1}.`,
    `Words on page ${i + 1} of the contents book.`,
  ],
}));
const EPUB_SEGMENTS = [1, 2, 3].map((n) => ({
  seq: n - 1,
  label: `Chapter ${n}`,
  paragraphs: [`C${n} text`],
}));

async function addBook(page: Page, format: 'pdf' | 'epub'): Promise<string> {
  const created = await page.request.post('/api/books', {
    data: { title: 'Contents Book', author: null, format, sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as { bookId: string; signedUploadUrl: string };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': format === 'pdf' ? 'application/pdf' : 'application/epub+zip' },
    body: readFileSync(`tests/fixtures/contents.${format}`),
  });
  expect(put.ok).toBe(true);
  const segments = await page.request.post(`/api/books/${bookId}/segments`, {
    data: { segments: format === 'pdf' ? PDF_SEGMENTS : EPUB_SEGMENTS, done: true },
  });
  expect(segments.status()).toBe(204);
  return bookId;
}

const pdfSelection = (bookId: string, page: number, text: string) => ({
  bookId,
  segmentSeq: page - 1,
  text,
  prefix: '',
  anchor: { format: 'pdf', page, rects: [{ x: 0.115, y: 0.075, w: 0.3, h: 0.025 }] },
});

async function addNote(page: Page, bookId: string, selection: object, color: string, note?: string) {
  const res = await page.request.post('/api/highlights', { data: { bookId, selection, color } });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  if (note) expect((await page.request.patch(`/api/highlights/${id}`, { data: { note } })).ok()).toBe(true);
}

/** A PDF with a note on page 1, a plain highlight on page 3 and a Define thread on page 5. */
async function pdfWithHighlights(page: Page): Promise<string> {
  const bookId = await addBook(page, 'pdf');
  await addNote(page, bookId, pdfSelection(bookId, 1, 'Chapter 1, page 1.'), 'yellow', 'Where it starts.');
  await addNote(page, bookId, pdfSelection(bookId, 3, 'Chapter 2, page 3.'), 'green');
  const thread = await page.request.post('/api/threads', {
    data: {
      bookId,
      action: 'define',
      selection: pdfSelection(bookId, 5, 'Chapter 3, page 5.'),
      scope: 'page',
    },
  });
  expect(thread.status()).toBe(201);
  return bookId;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'In this book' });
const threadPanel = (page: Page) => page.getByRole('complementary', { name: 'Thread', exact: true });
const bookmark = (page: Page) => page.getByRole('button', { name: 'Highlights and threads' });

test('the bookmark opens the highlights grouped by chapter, with All / Notes / Threads tabs', async ({
  page,
}) => {
  const bookId = await pdfWithHighlights(page);
  await page.goto(`/read/${bookId}`);
  await expect(page.getByLabel('Page number')).toHaveValue('1');

  await expect(bookmark(page)).toHaveAttribute('aria-pressed', 'false');
  await bookmark(page).click();
  await expect(bookmark(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByRole('heading', { name: 'In this book' })).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page)).toContainText('3 items');

  // Grouped by the PDF's bookmarks, in book order.
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText([
    'Chapter 1',
    'Chapter 2',
    'Chapter 3',
  ]);
  const links = panel(page).getByRole('link');
  await expect(links).toHaveText([
    '“Chapter 1, page 1.”Note · Where it starts.',
    '“Chapter 2, page 3.”Highlight',
    '“Chapter 3, page 5.”Thread · Define',
  ]);
  // Real links, so one can open in a new tab: ?at=, and ?thread= for a thread.
  await expect(links.nth(0)).toHaveAttribute('href', new RegExp(`^/read/${bookId}\\?at=`));
  await expect(links.nth(2)).toHaveAttribute('href', /[?&]thread=/);

  await panel(page).getByRole('tab', { name: 'Notes' }).click();
  await expect(panel(page)).toContainText('2 items');
  await expect(links).toHaveCount(2);
  await expect(panel(page).getByRole('tabpanel')).toHaveAccessibleName('Notes');

  // The arrow keys move between the tabs (and don't turn the page).
  await page.keyboard.press('ArrowRight');
  await expect(panel(page).getByRole('tab', { name: 'Threads' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page)).toContainText('1 item');
  await expect(links).toHaveText(['“Chapter 3, page 5.”Thread · Define']);
  await expect(page.getByLabel('Page number')).toHaveValue('1');

  await panel(page).getByRole('button', { name: 'Close panel' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(bookmark(page)).toHaveAttribute('aria-pressed', 'false');
});

test('a click goes to the highlight; a thread opens in place of the list', async ({ page }, testInfo) => {
  const bookId = await pdfWithHighlights(page);
  await page.goto(`/read/${bookId}`);
  await expect(page.getByLabel('Page number')).toHaveValue('1');

  await bookmark(page).click();
  await panel(page)
    .getByRole('link', { name: /Chapter 2, page 3/ })
    .click();
  await expect(page.getByLabel('Page number')).toHaveValue('3');
  await expect(page).toHaveURL(`/read/${bookId}`);
  if (testInfo.project.name === 'phone') {
    // On a phone the list is a sheet over the book, so it gets out of the way.
    await expect(panel(page)).toBeHidden();
    await bookmark(page).click();
  } else {
    await expect(panel(page)).toBeVisible();
  }

  await panel(page)
    .getByRole('link', { name: /Thread · Define/ })
    .click();
  await expect(page.getByLabel('Page number')).toHaveValue('5');
  await expect(threadPanel(page)).toBeVisible();
  await expect(threadPanel(page)).toContainText('Chapter 3, page 5.');
  await expect(panel(page)).toBeHidden();

  // One panel at a time: the bookmark puts the list back in place of the thread.
  await bookmark(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(threadPanel(page)).toBeHidden();
});

test("an EPUB's highlights are grouped by chapter and a click goes to the chapter", async ({ page }) => {
  const bookId = await addBook(page, 'epub');
  const epubSelection = (seq: number, text: string, cfi: string) => ({
    bookId,
    segmentSeq: seq,
    text,
    prefix: '',
    anchor: { format: 'epub', cfi },
  });
  // Added out of order: the list is in book order.
  await addNote(page, bookId, epubSelection(2, 'quiet river', 'epubcfi(/6/6!/4/4,/1:7,/1:18)'), 'pink');
  await addNote(
    page,
    bookId,
    epubSelection(0, 'the quiet river', 'epubcfi(/6/2!/4/4,/1:6,/1:21)'),
    'blue',
    'Calm.',
  );
  await page.goto(`/read/${bookId}`);
  await expect(page.getByRole('banner')).toContainText('Chapter 1');

  await bookmark(page).click();
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(['Chapter 1', 'Chapter 3']);
  await panel(page)
    .getByRole('link', { name: /“quiet river”/ })
    .click();
  await expect(page.getByRole('banner')).toContainText('Chapter 3');
});

test('a book without highlights says so', async ({ page }) => {
  const bookId = await addBook(page, 'pdf');
  await page.goto(`/read/${bookId}`);
  await bookmark(page).click();
  await expect(panel(page)).toContainText('0 items');
  await expect(panel(page)).toContainText('Nothing here yet.');
  await panel(page).getByRole('tab', { name: 'Threads' }).click();
  await expect(panel(page)).toContainText('No threads yet.');
});
