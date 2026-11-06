import { readFileSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

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

/** The sample EPUB with its text prepared (so highlights can be saved), arranged through the API. */
async function addSampleEpub(page: Page): Promise<string> {
  const created = await page.request.post('/api/books', {
    data: { title: 'Sample Book', author: null, format: 'epub', sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as { bookId: string; signedUploadUrl: string };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/epub+zip' },
    body: readFileSync('tests/fixtures/sample.epub'),
  });
  expect(put.ok).toBe(true);
  const segments = await page.request.post(`/api/books/${bookId}/segments`, {
    data: { segments: EPUB_SEGMENTS, done: true },
  });
  expect(segments.status()).toBe(204);
  return bookId;
}

/** The frame foliate renders the current chapter into. */
async function chapterFrame(page: Page): Promise<Frame> {
  const find = () => page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank') ?? null;
  await expect.poll(find).not.toBeNull();
  return find()!;
}

const replaced = (e: Error) => {
  if (/Execution context was destroyed|Frame was detached/.test(e.message)) return [];
  throw e;
};

/**
 * Where the first line of each paragraph (P1, P2, …) on screen right now starts, in the page's
 * coordinates. The first line, not the paragraph's box: a paragraph split across two columns
 * spans both. Empty while foliate is replacing the chapter's iframe, so a poll looks again.
 */
async function visibleStarts(page: Page): Promise<{ marker: string; x: number }[]> {
  const frame = await chapterFrame(page);
  return frame
    .evaluate(() => {
      // The chapter's iframe is as wide as all its pages; the elements around it clip it to the
      // current page, so the next page can sit inside the window and still be hidden.
      const view = { left: 0, top: 0, right: window.top!.innerWidth, bottom: window.top!.innerHeight };
      for (let el = window.frameElement?.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).overflow === 'visible') continue;
        const r = el.getBoundingClientRect();
        view.left = Math.max(view.left, r.left);
        view.top = Math.max(view.top, r.top);
        view.right = Math.min(view.right, r.right);
        view.bottom = Math.min(view.bottom, r.bottom);
      }
      const offset = window.frameElement!.getBoundingClientRect();
      const seen: { marker: string; x: number }[] = [];
      for (const p of document.querySelectorAll('p')) {
        const node = p.firstChild;
        const marker = /^P\d+/.exec(p.textContent ?? '')?.[0];
        if (!node || !marker) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        const r = range.getClientRects()[0];
        if (!r) continue;
        const left = r.left + offset.left;
        const top = r.top + offset.top;
        if (left >= view.left && left + r.width <= view.right && top >= view.top && top + r.height <= view.bottom)
          seen.push({ marker, x: left });
      }
      return seen;
    })
    .catch(replaced);
}

const visibleMarkers = async (page: Page) => (await visibleStarts(page)).map((s) => s.marker);

/** The book's box: the part of the reader that the tap zones divide in thirds. */
async function bookBox(page: Page) {
  const box = await page.locator('foliate-view').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Taps the book `share` of the way across (0 to 1), halfway down. */
async function tapAcross(page: Page, share: number) {
  const box = await bookBox(page);
  await page.touchscreen.tap(box.x + box.width * share, box.y + box.height / 2);
}

/**
 * A word on screen in the book's right third, in the page's coordinates, with the selection
 * set on it: one a tap zone would turn the page for.
 */
async function selectWordInRightThird(page: Page, frame: Frame) {
  const box = await bookBox(page);
  const word = await frame.evaluate((from) => {
    const offset = window.frameElement!.getBoundingClientRect();
    for (const p of document.querySelectorAll('p')) {
      const node = p.firstChild as Text | null;
      if (!node) continue;
      for (const m of node.data.matchAll(/[a-z]{5,}/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const r = range.getClientRects()[0];
        if (!r) continue;
        const x = r.left + offset.left;
        const y = r.top + offset.top;
        if (x < from.left || x + r.width > from.right || y < from.top || y + r.height > from.bottom) continue;
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);
        return { x: x + r.width / 2, y: y + r.height / 2 };
      }
    }
    return null;
  }, { left: box.x + (box.width * 2) / 3 + 8, right: box.x + box.width - 60, top: box.y + 60, bottom: box.y + box.height - 60 });
  expect(word).not.toBeNull();
  return word!;
}

const menu = (page: Page) => page.getByRole('toolbar', { name: 'Selection menu' });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Note' });
// foliate ignores a page turn asked for within 100 ms of the previous one.
const settle = (page: Page) => page.waitForTimeout(300);

async function openBook(page: Page) {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => visibleMarkers(page)).toContain('P1');
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as { books: { id: string }[] };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

/** A tablet held sideways (an 11-inch iPad), used with a finger. */
const TABLET_LANDSCAPE = { viewport: { width: 1194, height: 834 }, hasTouch: true };

test.describe('on a tablet', () => {
  test.use(TABLET_LANDSCAPE);
  // The tablet's size is set here; the phone project's run would only repeat it.
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'the desktop project runs the tablet tests'));

  test('a tap on the right third turns the page forward, on the left third back', async ({ page }) => {
    await openBook(page);
    await tapAcross(page, 0.85);
    await expect.poll(() => visibleMarkers(page)).not.toContain('P1');
    await settle(page);
    await tapAcross(page, 0.15);
    await expect.poll(() => visibleMarkers(page)).toContain('P1');
  });

  test('a tap in the middle hides the controls, and the next one shows them', async ({ page }) => {
    await openBook(page);
    const settings = page.getByRole('button', { name: 'Reading settings' });
    const progress = page.getByRole('progressbar', { name: 'Reading progress' });
    const next = page.getByRole('button', { name: 'Next page' });
    await expect(settings).toBeVisible();

    await tapAcross(page, 0.5);
    await expect(settings).toBeHidden();
    await expect(progress).toBeHidden();
    await expect(next).toBeHidden();
    expect(await visibleMarkers(page)).toContain('P1');

    await tapAcross(page, 0.5);
    await expect(settings).toBeVisible();
    await expect(progress).toBeVisible();
    await expect(next).toBeVisible();
  });

  test('a tap on a highlight opens it and does not turn the page', async ({ page }) => {
    await openBook(page);
    const frame = await chapterFrame(page);
    const word = await selectWordInRightThird(page, frame);
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/highlights') && r.request().method() === 'POST',
    );
    await menu(page).getByRole('button', { name: 'Highlight yellow' }).click();
    expect((await created).status()).toBe(201);
    await expect(menu(page)).toHaveCount(0);
    // Saving leaves the words selected, and a tap that only clears a selection turns no page anyway.
    await frame.evaluate(() => document.getSelection()!.removeAllRanges());
    const before = await visibleMarkers(page);

    await page.touchscreen.tap(word.x, word.y);
    await expect(editor(page)).toBeVisible();
    await settle(page);
    expect(await visibleMarkers(page)).toEqual(before);
  });

  test('a tap that clears a selection does not turn the page', async ({ page }) => {
    await openBook(page);
    const frame = await chapterFrame(page);
    await selectWordInRightThird(page, frame);
    await expect(menu(page)).toBeVisible();

    await tapAcross(page, 0.85);
    await expect(menu(page)).toHaveCount(0);
    await settle(page);
    expect(await visibleMarkers(page)).toContain('P1');
  });
});

test.describe('with a mouse', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'the phone project is a touch screen'));

  test('a click in the text turns no page and hides nothing', async ({ page }) => {
    await openBook(page);
    const box = await bookBox(page);
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await settle(page);
    expect(await visibleMarkers(page)).toContain('P1');
    await expect(page.getByRole('button', { name: 'Reading settings' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'the phone project has the phone size'));

  test('the tap zones turn pages and hide the controls', async ({ page }) => {
    await openBook(page);
    await tapAcross(page, 0.85);
    await expect.poll(() => visibleMarkers(page)).not.toContain('P1');
    await settle(page);
    await tapAcross(page, 0.15);
    await expect.poll(() => visibleMarkers(page)).toContain('P1');

    const settings = page.getByRole('button', { name: 'Reading settings' });
    await tapAcross(page, 0.5);
    await expect(settings).toBeHidden();
    await tapAcross(page, 0.5);
    await expect(settings).toBeVisible();
  });
});
