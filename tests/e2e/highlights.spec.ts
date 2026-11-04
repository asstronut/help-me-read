import { readFileSync } from 'node:fs';
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const PDF_SEGMENTS = [
  {
    seq: 0,
    label: 'Page 1',
    paragraphs: [
      'She sat on the bank. The bank was steep. She sat on the bank.',
      'The river moved slowly under a pale and ephemeral light. Across the page break',
    ],
  },
  { seq: 1, label: 'Page 2', paragraphs: ['into page two.', 'Ephemeral joys fade quickly.'] },
  { seq: 2, label: 'Page 3', paragraphs: ['Final page.'] },
];

// The sample EPUB's first chapter, as its text preparation reads it (see tests/fixtures/make-fixtures.ts).
const FILLER =
  'the quiet river carried small boats past old stone bridges while patient readers turned pages beneath tall trees and listened to distant bells ring across the valley as evening settled slowly over every field and road'.split(
    ' ',
  );
function epubParagraph(n: number): string {
  const words = [`P${n}`];
  for (let i = 0; words.length < 60; i++) words.push(FILLER[(i + n) % FILLER.length]);
  return words.join(' ');
}
const EPUB_SEGMENTS = [
  { seq: 0, label: 'Chapter One', paragraphs: Array.from({ length: 12 }, (_, i) => epubParagraph(i + 1)) },
];

/** A book with its fixture stored and its text prepared, arranged through the API. */
async function addBook(page: Page, format: 'pdf' | 'epub'): Promise<string> {
  const created = await page.request.post('/api/books', {
    data: { title: 'Sample Book', author: null, format, sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as {
    bookId: string;
    signedUploadUrl: string;
  };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': format === 'pdf' ? 'application/pdf' : 'application/epub+zip' },
    body: readFileSync(`tests/fixtures/sample.${format}`),
  });
  expect(put.ok).toBe(true);
  const segments = await page.request.post(`/api/books/${bookId}/segments`, {
    data: { segments: format === 'pdf' ? PDF_SEGMENTS : EPUB_SEGMENTS, done: true },
  });
  expect(segments.status()).toBe(204);
  return bookId;
}

const pdfPage = (page: Page, n: number) => page.locator(`.react-pdf__Page[data-page-number="${n}"]`);
const textLayer = (page: Page, n: number) => pdfPage(page, n).locator('.react-pdf__Page__textContent');
const menu = (page: Page) => page.getByRole('toolbar', { name: 'Selection menu' });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Note' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Thread' });

type TextPoint = { pageNumber: number; text: string; edge: 'start' | 'end' };

/** Selects PDF text-layer text from one point to another, as a user's drag would. */
async function selectPdfText(page: Page, from: TextPoint, to: TextPoint) {
  await page.evaluate(
    ({ from, to }) => {
      function locate({ pageNumber, text, edge }: TextPoint): [Node, number] {
        const layer = document.querySelector(
          `.react-pdf__Page[data-page-number="${pageNumber}"] .react-pdf__Page__textContent`,
        )!;
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) nodes.push(walker.currentNode as Text);
        const at = nodes.map((n) => n.data).join('').indexOf(text);
        if (at < 0) throw new Error(`"${text}" not on page ${pageNumber}`);
        let offset = edge === 'start' ? at : at + text.length;
        for (const node of nodes) {
          if (offset <= node.data.length && !(edge === 'start' && offset === node.data.length))
            return [node, offset];
          offset -= node.data.length;
        }
        throw new Error('offset past the text layer');
      }
      const range = document.createRange();
      range.setStart(...locate(from));
      range.setEnd(...locate(to));
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    },
    { from, to },
  );
}

const selectOnPage = (page: Page, pageNumber: number, text: string) =>
  selectPdfText(page, { pageNumber, text, edge: 'start' }, { pageNumber, text, edge: 'end' });

/** The on-screen box of `text` in a PDF page's text layer. */
const pdfTextBox = (page: Page, pageNumber: number, text: string) =>
  page.evaluate(
    ({ pageNumber, text }) => {
      const layer = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageNumber}"] .react-pdf__Page__textContent`,
      )!;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const at = node.data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }
      throw new Error(`"${text}" not on page ${pageNumber}`);
    },
    { pageNumber, text },
  );

type Box = { x: number; y: number; width: number; height: number };

const overlapOf = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Taps the middle of a highlight, as a user would. */
async function tap(page: Page, highlight: Locator) {
  await expect(highlight).toBeVisible();
  const box = (await highlight.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function showPdfPage(page: Page, n: number) {
  await page.locator(`[data-slot="${n}"]`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(textLayer(page, n)).not.toBeEmpty();
}

async function openPdf(page: Page): Promise<string> {
  const bookId = await addBook(page, 'pdf');
  await page.goto(`/read/${bookId}`);
  await expect(textLayer(page, 1)).toContainText('steep');
  return bookId;
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string }[];
  };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

test('a green note on a PDF page keeps its note and its words at any zoom', async ({ page }) => {
  await openPdf(page);
  await showPdfPage(page, 3);
  await selectOnPage(page, 3, 'Final page.');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/highlights') && r.request().method() === 'POST',
  );
  await menu(page).getByRole('button', { name: 'Highlight green' }).click();
  expect((await created).status()).toBe(201);

  const note = pdfPage(page, 3).locator('[data-highlight-kind="note"]');
  await expect(note).toHaveCount(1);
  await tap(page, note);
  await editor(page).getByLabel('Note text').fill('ok');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page)).toHaveCount(0);

  await page.reload();
  await showPdfPage(page, 3);
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute('data-highlight-color', 'green');
  await tap(page, note);
  await expect(editor(page).getByLabel('Note text')).toHaveValue('ok');
  await expect(editor(page).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true');
  await editor(page).getByRole('button', { name: 'Close' }).click();

  const before = (await note.boundingBox())!;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await showPdfPage(page, 3);
  await expect.poll(async () => (await note.boundingBox())?.width ?? 0).toBeGreaterThan(before.width * 1.3);
  await expect
    .poll(async () => {
      const span = await pdfTextBox(page, 3, 'Final page.');
      const box = await note.boundingBox();
      return box ? overlapOf(span, box) / (span.width * span.height) : 0;
    })
    .toBeGreaterThan(0.8);
});

test('the note editor changes the colour and deletes the highlight', async ({ page }) => {
  const bookId = await openPdf(page);
  await selectOnPage(page, 1, 'The bank was steep.');
  await menu(page).getByRole('button', { name: 'Highlight yellow' }).click();
  const note = pdfPage(page, 1).locator('[data-highlight-kind="note"]');
  await expect(note).toHaveCount(1);

  await tap(page, note);
  await editor(page).getByRole('button', { name: 'Pink' }).click();
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(note).toHaveAttribute('data-highlight-color', 'pink');

  await tap(page, note);
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  await expect(note).toHaveCount(0);
  const { highlights } = (await (await page.request.get(`/api/highlights?bookId=${bookId}`)).json()) as {
    highlights: unknown[];
  };
  expect(highlights).toEqual([]);
});

test('a thread on a selection across a page break is underlined on its start page only', async ({
  page,
}) => {
  await openPdf(page);
  await expect(textLayer(page, 2)).toContainText('into page two.');
  await selectPdfText(
    page,
    { pageNumber: 1, text: 'Across', edge: 'start' },
    { pageNumber: 2, text: 'two.', edge: 'end' },
  );
  await menu(page).getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Explain' }).click();
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');

  const marks = page.locator('[data-highlight-kind="thread"]');
  await expect(marks).not.toHaveCount(0);
  await expect(pdfPage(page, 2).locator('[data-highlight-kind]')).toHaveCount(0);
  const pageBox = (await pdfPage(page, 1).boundingBox())!;
  for (const mark of await marks.all()) {
    const box = (await mark.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(pageBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(pageBox.y + pageBox.height);
    await expect(mark).toHaveCSS('border-bottom-style', 'dotted');
  }
});

test('tapping a thread highlight reopens its thread with the saved answers', async ({ page }) => {
  await openPdf(page);
  await expect(textLayer(page, 2)).toContainText('Ephemeral');
  await selectOnPage(page, 2, 'Ephemeral');
  await menu(page).getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Define' }).click();
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');

  await page.reload();
  await showPdfPage(page, 2);
  await expect(panel(page)).toHaveCount(0);
  await tap(page, pdfPage(page, 2).locator('[data-highlight-kind="thread"]'));
  await expect(panel(page).getByRole('article')).toHaveCount(1);
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');
});

/** The frame foliate renders the current chapter into. */
async function chapterFrame(page: Page): Promise<Frame> {
  const find = () => page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank') ?? null;
  await expect.poll(find).not.toBeNull();
  return find()!;
}

/** The on-screen box of `word` in the chapter paragraph starting with `marker`. */
async function epubWordBox(page: Page, frame: Frame, marker: string, word: string): Promise<Box> {
  await expect(frame.locator('p', { hasText: marker })).not.toHaveCount(0);
  const inFrame = await frame.evaluate(
    ({ marker, word }) => {
      const p = [...document.querySelectorAll('p')].find((el) => el.textContent?.startsWith(`${marker} `))!;
      const node = p.firstChild as Text;
      const at = node.data.indexOf(word);
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const r = range.getBoundingClientRect();
      document.getSelection()!.removeAllRanges();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    { marker, word },
  );
  const frameBox = (await (await frame.frameElement()).boundingBox())!;
  return { ...inFrame, x: inFrame.x + frameBox.x, y: inFrame.y + frameBox.y };
}

/** The on-screen box of `word`, turning pages until it is on screen (a narrow screen paginates sooner). */
async function epubWordOnScreen(page: Page, frame: Frame, marker: string, word: string): Promise<Box> {
  const viewport = page.viewportSize()!;
  let box = await epubWordBox(page, frame, marker, word);
  for (let turns = 0; box.x + box.width > viewport.width && turns < 10; turns++) {
    const before = box.x;
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(async () => (await epubWordBox(page, frame, marker, word)).x).not.toBe(before);
    box = await epubWordBox(page, frame, marker, word);
  }
  return box;
}

/**
 * The centre of `word` once the chapter has stopped moving. Opening or closing the thread panel
 * on desktop resizes the book beside it, and the chapter re-lays out.
 */
async function settledWordCentre(page: Page, frame: Frame, marker: string, word: string) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await epubWordBox(page, frame, marker, word));
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [250] },
    )
    .toBe(true);
  return centre(await epubWordOnScreen(page, frame, marker, word));
}

const centre = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function selectInParagraph(frame: Frame, marker: string, word: string) {
  await frame.evaluate(
    ({ marker, word }) => {
      const p = [...document.querySelectorAll('p')].find((el) => el.textContent?.startsWith(`${marker} `))!;
      const node = p.firstChild as Text;
      const at = node.data.indexOf(word);
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    },
    { marker, word },
  );
}

test('an EPUB note persists after a reload', async ({ page }) => {
  const bookId = await addBook(page, 'epub');
  await page.goto(`/read/${bookId}`);
  const frame = await chapterFrame(page);
  await expect(frame.locator('p', { hasText: 'P6' })).not.toHaveCount(0);
  await selectInParagraph(frame, 'P6', 'bridges');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/highlights') && r.request().method() === 'POST',
  );
  await menu(page).getByRole('button', { name: 'Highlight blue' }).click();
  expect((await created).status()).toBe(201);

  await page.reload();
  const reloaded = await chapterFrame(page);
  await expect
    .poll(async () => {
      const { x, y } = centre(await epubWordOnScreen(page, reloaded, 'P6', 'bridges'));
      await page.mouse.click(x, y);
      return editor(page).count();
    })
    .toBe(1);
  await expect(editor(page).getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
});

/** Highlights `word` in paragraph `marker` with a colour from the selection menu. */
async function epubNote(page: Page, frame: Frame, marker: string, word: string, color: string) {
  await selectInParagraph(frame, marker, word);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/highlights') && r.request().method() === 'POST',
  );
  await menu(page).getByRole('button', { name: `Highlight ${color}` }).click();
  expect((await created).status()).toBe(201);
}

async function openEpub(page: Page): Promise<Frame> {
  const bookId = await addBook(page, 'epub');
  await page.goto(`/read/${bookId}`);
  const frame = await chapterFrame(page);
  await expect(frame.locator('p', { hasText: 'P6' })).not.toHaveCount(0);
  return frame;
}

test('dragging a selection onto an EPUB highlight opens the menu, not the note editor', async ({ page }) => {
  const frame = await openEpub(page);
  await epubNote(page, frame, 'P6', 'bridges', 'blue');
  await expect(menu(page)).toHaveCount(0);

  const from = await epubWordOnScreen(page, frame, 'P6', 'stone');
  const to = centre(await epubWordOnScreen(page, frame, 'P6', 'bridges'));
  await page.mouse.move(from.x + 1, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect(menu(page)).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
});

test('a note and a thread on the same EPUB words are both reachable', async ({ page }) => {
  const frame = await openEpub(page);
  await epubNote(page, frame, 'P6', 'bridges', 'pink');
  await selectInParagraph(frame, 'P6', 'bridges');
  await menu(page).getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Define' }).click();
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toHaveCount(0);

  // A tap opens the most recent (the thread); tapping again reaches the next (the note).
  const word = await settledWordCentre(page, frame, 'P6', 'bridges');
  await page.mouse.click(word.x, word.y);
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');
  await panel(page).getByRole('button', { name: 'Close' }).click();
  const again = await settledWordCentre(page, frame, 'P6', 'bridges');
  await page.mouse.click(again.x, again.y);
  await expect(editor(page).getByRole('button', { name: 'Pink' })).toHaveAttribute('aria-pressed', 'true');
});

/** Opens a Define thread on "Ephemeral" (page 2) and returns its id once answered. */
async function defineEphemeral(page: Page): Promise<string> {
  await expect(textLayer(page, 2)).toContainText('Ephemeral');
  await selectOnPage(page, 2, 'Ephemeral');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/threads') && r.request().method() === 'POST',
  );
  await menu(page).getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Define' }).click();
  const { threadId } = (await (await created).json()) as { threadId: string };
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');
  return threadId;
}

test('deleting a thread from its panel removes its highlight and the thread', async ({ page }) => {
  await openPdf(page);
  const threadId = await defineEphemeral(page);
  const marks = pdfPage(page, 2).locator('[data-highlight-kind="thread"]');
  await expect(marks).not.toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Delete thread' }).click();
  await expect(panel(page).getByText('Delete this conversation?')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Yes, delete' }).click();

  await expect(panel(page)).toHaveCount(0);
  await expect(marks).toHaveCount(0);
  expect((await page.request.get(`/api/threads/${threadId}`)).status()).toBe(404);
});

test('a thread reopened by tapping its highlight can be deleted', async ({ page }) => {
  await openPdf(page);
  const threadId = await defineEphemeral(page);
  await page.reload();
  await showPdfPage(page, 2);
  const mark = pdfPage(page, 2).locator('[data-highlight-kind="thread"]');
  await tap(page, mark);
  await expect(panel(page).getByRole('article').first()).toContainText('MOCK ANSWER');

  await panel(page).getByRole('button', { name: 'Delete thread' }).click();
  await panel(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page).getByRole('article')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Delete thread' }).click();
  await panel(page).getByRole('button', { name: 'Yes, delete' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(mark).toHaveCount(0);
  expect((await page.request.get(`/api/threads/${threadId}`)).status()).toBe(404);
});

test('a failed thread delete says so and keeps the thread', async ({ page }) => {
  await openPdf(page);
  await defineEphemeral(page);
  await page.route('**/api/highlights/*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, body: 'Internal Server Error' })
      : route.continue(),
  );
  await panel(page).getByRole('button', { name: 'Delete thread' }).click();
  await panel(page).getByRole('button', { name: 'Yes, delete' }).click();
  await expect(panel(page).getByText('Could not delete this thread.')).toBeVisible();
  await expect(pdfPage(page, 2).locator('[data-highlight-kind="thread"]')).not.toHaveCount(0);
});
