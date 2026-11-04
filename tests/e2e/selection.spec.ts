import { readFileSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';
import type { ReaderSelection } from '@/lib/types';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

/** Creates a book with a fixture stored, without going through the library UI. */
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
  return bookId;
}

const menu = (page: Page) => page.getByRole('toolbar', { name: 'Selection menu' });
const actions = (page: Page) => menu(page).getByRole('group', { name: 'Actions' }).getByRole('button');

const currentSelection = (page: Page) =>
  page.evaluate(() => (window as Window & { __hmrSelection?: ReaderSelection | null }).__hmrSelection);

type TextPoint = { pageNumber: number; text: string; nth?: number; edge: 'start' | 'end' };

/**
 * Selects PDF text-layer text from one point to another the way a user's drag ends up:
 * a DOM selection over the text-layer nodes, which fires `selectionchange`.
 */
async function selectPdfText(page: Page, from: TextPoint, to: TextPoint) {
  await page.evaluate(
    ({ from, to }) => {
      function locate({ pageNumber, text, nth = 1, edge }: TextPoint): [Node, number] {
        const layer = document.querySelector(
          `.react-pdf__Page[data-page-number="${pageNumber}"] .react-pdf__Page__textContent`,
        )!;
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) nodes.push(walker.currentNode as Text);
        const all = nodes.map((n) => n.data).join('');
        let at = -1;
        for (let i = 0; i < nth; i++) at = all.indexOf(text, at + 1);
        if (at < 0) throw new Error(`"${text}" #${nth} not on page ${pageNumber}`);
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
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { from, to },
  );
}

/** Double-clicks a word in the PDF text layer with the mouse. */
async function doubleClickPdfWord(page: Page, word: string) {
  const box = await page.evaluate((word) => {
    const layer = document.querySelector('.react-pdf__Page__textContent')!;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(word);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    throw new Error(`"${word}" not in the text layer`);
  }, word);
  await page.mouse.dblclick(box.x, box.y);
}

async function openPdf(page: Page) {
  const id = await addBook(page, 'pdf');
  await page.goto(`/read/${id}`);
  await expect(
    page.locator('.react-pdf__Page[data-page-number="1"] .react-pdf__Page__textContent'),
  ).toContainText('steep');
  return id;
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string }[];
  };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

test('a single word puts Define first', async ({ page }) => {
  await openPdf(page);
  await doubleClickPdfWord(page, 'steep');
  await expect(actions(page)).toHaveText(['Define', 'Translate', 'Explain', 'Simplify', 'Ask…', '+Vocab']);
  await expect(menu(page).getByRole('group', { name: 'Highlight colour' }).getByRole('button')).toHaveCount(4);
  expect((await currentSelection(page))?.text).toBe('steep');
});

test('a phrase puts Explain first', async ({ page }) => {
  await openPdf(page);
  await selectPdfText(
    page,
    { pageNumber: 1, text: 'The bank was steep.', edge: 'start' },
    { pageNumber: 1, text: 'The bank was steep.', edge: 'end' },
  );
  await expect(actions(page)).toHaveText(['Explain', 'Translate', 'Define', 'Simplify', 'Ask…', '+Vocab']);
  const selection = await currentSelection(page);
  expect(selection?.text).toBe('The bank was steep.');
  expect(selection?.anchor).toMatchObject({ format: 'pdf', page: 1 });
});

test('a selection across a page break belongs to the page it starts on', async ({ page }) => {
  const id = await openPdf(page);
  await expect(page.locator('.react-pdf__Page[data-page-number="2"] .react-pdf__Page__textContent')).toContainText(
    'into page two.',
  );
  await selectPdfText(
    page,
    { pageNumber: 1, text: 'Across', edge: 'start' },
    { pageNumber: 2, text: 'two.', edge: 'end' },
  );
  await expect(menu(page)).toBeVisible();
  const selection = (await currentSelection(page))!;
  expect(selection.bookId).toBe(id);
  expect(selection.segmentSeq).toBe(0);
  expect(selection.text).toBe('Across the page break into page two.');
  if (selection.anchor.format !== 'pdf') throw new Error('expected a PDF anchor');
  expect(selection.anchor.page).toBe(1);
  expect(selection.anchor.rects.length).toBeGreaterThan(0);
  for (const r of selection.anchor.rects) {
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  }
});

test('the prefix tells a repeated sentence apart', async ({ page }) => {
  await openPdf(page);
  await selectPdfText(
    page,
    { pageNumber: 1, text: 'She sat on the bank.', nth: 2, edge: 'start' },
    { pageNumber: 1, text: 'She sat on the bank.', nth: 2, edge: 'end' },
  );
  await expect(menu(page)).toBeVisible();
  const selection = (await currentSelection(page))!;
  expect(selection.text).toBe('She sat on the bank.');
  expect(selection.prefix.endsWith('The bank was steep. ')).toBe(true);
});

test('clearing the selection closes the menu', async ({ page }) => {
  await openPdf(page);
  await doubleClickPdfWord(page, 'steep');
  await expect(menu(page)).toBeVisible();
  await page.evaluate(() => document.getSelection()!.removeAllRanges());
  await expect(menu(page)).toHaveCount(0);
  expect(await currentSelection(page)).toBeNull();
});

test('the menu sits above the selection on desktop and docks to the bottom on a phone', async ({
  page,
}, testInfo) => {
  await openPdf(page);
  await selectPdfText(
    page,
    { pageNumber: 1, text: 'The bank was steep.', edge: 'start' },
    { pageNumber: 1, text: 'The bank was steep.', edge: 'end' },
  );
  const box = (await menu(page).boundingBox())!;
  if (testInfo.project.name === 'phone') {
    expect(Math.abs(box.y + box.height - page.viewportSize()!.height)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  } else {
    const selectionTop = await page.evaluate(
      () => document.getSelection()!.getRangeAt(0).getBoundingClientRect().top,
    );
    expect(box.y + box.height).toBeLessThanOrEqual(selectionTop);
  }
});

test('a selection taller than the screen keeps the menu on screen', async ({ page }) => {
  await openPdf(page);
  // scroll page 2 to the top, so the selection starts above the screen and ends below it
  await page.locator('[data-slot="2"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(page.getByLabel('Page number')).toHaveValue('2');
  await expect(page.locator('.react-pdf__Page[data-page-number="3"] .react-pdf__Page__textContent')).toContainText(
    'Final page.',
  );
  await selectPdfText(
    page,
    { pageNumber: 1, text: 'She sat on the bank.', edge: 'start' },
    { pageNumber: 3, text: 'Final page.', edge: 'end' },
  );
  await expect(menu(page)).toBeVisible();
  expect((await currentSelection(page))!.segmentSeq).toBe(0);
  const box = (await menu(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
});

test('a passage over 2,000 words is refused', async ({ page }) => {
  await page.goto('/__test/menu?words=2001');
  await expect(menu(page)).toHaveText('Select a shorter passage');
  await expect(menu(page).getByRole('button')).toHaveCount(0);

  await page.goto('/__test/menu?words=2000');
  await expect(actions(page)).toHaveCount(6);
});

/** The frame foliate renders the current chapter into. */
async function chapterFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank') ?? null)
    .not.toBeNull();
  return page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank')!;
}

/** Selects `word` (its first occurrence) in the chapter paragraph starting with `marker`. */
async function selectInParagraph(frame: Frame, marker: string, word: string) {
  await expect(frame.locator('p', { hasText: marker })).not.toHaveCount(0);
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

test('selecting a word in an EPUB chapter opens the menu for that section', async ({ page }) => {
  const id = await addBook(page, 'epub');
  await page.goto(`/read/${id}`);
  await selectInParagraph(await chapterFrame(page), 'P6', 'bridges');
  await expect(actions(page).first()).toHaveText('Define');
  const selection = (await currentSelection(page))!;
  expect(selection.bookId).toBe(id);
  expect(selection.segmentSeq).toBe(0);
  expect(selection.text).toBe('bridges');
  expect(selection.anchor.format).toBe('epub');
  expect(selection.prefix).toMatch(/P6 past old stone $/);
});

test('an EPUB prefix reads like the extracted paragraphs', async ({ page }) => {
  const id = await addBook(page, 'epub');
  await page.goto(`/read/${id}`);
  await selectInParagraph(await chapterFrame(page), 'P7', 'P7');
  await expect(menu(page)).toBeVisible();
  const { prefix } = (await currentSelection(page))!;
  // P6 ends "... across the valley as evening"; P7 follows it as a separate paragraph
  expect(prefix.endsWith('across the valley as evening ')).toBe(true);
  expect(prefix).not.toMatch(/\s\s|\n/);
});

test('an EPUB selection starting inside a word keeps the prefix glued to it', async ({ page }) => {
  const id = await addBook(page, 'epub');
  await page.goto(`/read/${id}`);
  await selectInParagraph(await chapterFrame(page), 'P6', 'ridges');
  await expect(menu(page)).toBeVisible();
  const selection = (await currentSelection(page))!;
  expect(selection.text).toBe('ridges');
  expect(selection.prefix).toMatch(/P6 past old stone b$/);
});
