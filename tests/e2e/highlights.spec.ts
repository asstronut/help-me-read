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

/** A book with its fixture stored (and, for a PDF, its text prepared), arranged through the API. */
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
  if (format === 'pdf') {
    const segments = await page.request.post(`/api/books/${bookId}/segments`, {
      data: { segments: PDF_SEGMENTS, done: true },
    });
    expect(segments.status()).toBe(204);
  }
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
  // On a narrow screen the word may be a few pages in.
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await epubWordBox(page, reloaded, 'P6', 'bridges');
      const x = box.x + box.width / 2;
      if (x > viewport.width) {
        await page.getByRole('button', { name: 'Next page' }).click();
        return 0;
      }
      await page.mouse.click(x, box.y + box.height / 2);
      return editor(page).count();
    })
    .toBe(1);
  await expect(editor(page).getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
});
