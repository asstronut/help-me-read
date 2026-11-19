import { readFileSync } from 'node:fs';
import { expect, test, type JSHandle, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

// Twelve pages with wide white margins (tests/fixtures/make-fixtures.ts). Pages 4, 6 and 8 are the
// ones the crop would cut: a stamp in the margin, a sheet on its side, a sheet turned a quarter.
const MARGINS_PDF = readFileSync('tests/fixtures/margins.pdf');
const CUT_PAGES = [4, 6, 8];

async function addPdf(page: Page, file: Uint8Array = MARGINS_PDF): Promise<string> {
  const created = await page.request.post('/api/books', {
    data: { title: 'Margins Book', author: null, format: 'pdf', sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as { bookId: string; signedUploadUrl: string };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: Buffer.from(file),
  });
  expect(put.ok).toBe(true);
  return bookId;
}

const slot = (page: Page, n: number) => page.locator(`[data-slot="${n}"]`);
const pdfPage = (page: Page, n: number) => page.locator(`.react-pdf__Page[data-page-number="${n}"]`);
const textLayer = (page: Page, n: number) => pdfPage(page, n).locator('.react-pdf__Page__textContent');
const pageInput = (page: Page) => page.getByLabel('Page number');
const settings = (page: Page) => page.getByRole('dialog', { name: 'Reading settings' });
const cropOption = (page: Page) => settings(page).getByRole('checkbox', { name: 'Crop white margins' });
const menu = (page: Page) => page.getByRole('toolbar', { name: 'Selection menu' });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Note' });

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await expect(settings(page)).toBeVisible();
}

const closeSettings = (page: Page) => page.keyboard.press('Escape');

/** Has the option on from the start, as on a device where it was ticked before. */
const cropFromTheStart = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('hmr.cropPdfMargins', 'true'));

type Box = { x: number; y: number; width: number; height: number };
const boxOf = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;

/** The width of a page's slot as a share of the page drawn in it: 1 without a crop, the box's share with one. */
const slotShare = async (page: Page, n: number) => (await boxOf(slot(page, n))).width / (await boxOf(pdfPage(page, n))).width;

/** Waits until page `n` is shown through the book's box. */
async function expectCropped(page: Page, n = 1) {
  await expect(textLayer(page, n)).not.toBeEmpty();
  await expect.poll(() => slotShare(page, n)).toBeLessThan(0.8);
}

async function openCropped(page: Page, id: string, query = '') {
  await cropFromTheStart(page);
  await page.goto(`/read/${id}${query}`);
}

/** The on-screen box of `text` in a PDF page's text layer. */
const textBox = (page: Page, n: number, text: string) =>
  textLayer(page, n).evaluate((layer, text) => {
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
    throw new Error(`"${text}" not on the page`);
  }, text);

/** Selects `text` on a page by dragging the mouse over it, as a reader would. */
async function dragOver(page: Page, n: number, text: string) {
  // The words may be below the window: bring their line to the middle of the view first.
  const { y: before } = await textBox(page, n, text);
  await slot(page, n).evaluate((el, y) => {
    const view = el.closest<HTMLElement>('.overflow-auto')!;
    view.scrollTop += y - view.getBoundingClientRect().top - view.clientHeight / 2;
  }, before);
  const box = await textBox(page, n, text);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 4 });
  await page.mouse.move(box.x + box.width - 1, y, { steps: 4 });
  await page.mouse.up();
}

/** The share of `inner` that lies inside `outer`. */
const shareInside = (inner: Box, outer: Box) =>
  (Math.max(0, Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x)) *
    Math.max(0, Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y))) /
  (inner.width * inner.height);

/** Whether the highlight covers the words, and both are inside the page's slot (so on screen, not clipped away). */
async function expectHighlightOnWords(page: Page, n: number, text: string) {
  const note = pdfPage(page, n).locator('[data-highlight-kind="note"]');
  await expect
    .poll(async () => {
      const [words, mark, window] = await Promise.all([textBox(page, n, text), note.boundingBox(), boxOf(slot(page, n))]);
      return mark ? Math.min(shareInside(words, mark), shareInside(words, window)) : 0;
    })
    .toBeGreaterThan(0.8);
}

/** How far the top of a page's slot is from the top of the view, in pixels. */
const slotTopInView = (page: Page, n: number) =>
  slot(page, n).evaluate((el) =>
    Math.abs(el.getBoundingClientRect().top - el.closest('.overflow-auto')!.getBoundingClientRect().top),
  );

async function addNote(page: Page, bookId: string, n: number, text: string, rect: { x: number; y: number; w: number; h: number }) {
  const res = await page.request.post('/api/highlights', {
    data: {
      bookId,
      color: 'yellow',
      selection: { bookId, segmentSeq: n - 1, text, prefix: '', anchor: { format: 'pdf', page: n, rects: [rect] } },
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { anchor: object }).anchor;
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as { books: { id: string }[] };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

test('Crop white margins is off until ticked, shows the text without its margins, and is remembered', async ({
  page,
}) => {
  const id = await addPdf(page);
  await page.goto(`/read/${id}`);
  await expect(textLayer(page, 1)).not.toBeEmpty();
  expect(await slotShare(page, 1)).toBeCloseTo(1, 2);
  const before = await textBox(page, 1, 'Page 1 of the margins book.');

  await openSettings(page);
  await expect(cropOption(page)).not.toBeChecked();
  await cropOption(page).check();
  await closeSettings(page);
  await expectCropped(page);

  // The text starts near the slot's left edge now, and is bigger than it was.
  const window = await boxOf(slot(page, 1));
  const after = await textBox(page, 1, 'Page 1 of the margins book.');
  expect(after.x - window.x).toBeLessThan(window.width * 0.05);
  expect(after.x - window.x).toBeGreaterThanOrEqual(0);
  expect(after.width).toBeGreaterThan(before.width * 1.2);
  // The slot clips the page, so the column is no wider than before.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.reload();
  await expectCropped(page);
  await openSettings(page);
  await expect(cropOption(page)).toBeChecked();
  await cropOption(page).uncheck();
  await closeSettings(page);
  await expect.poll(() => slotShare(page, 1)).toBeCloseTo(1, 2);
});

test('with the crop, Fit width fits the box to the column and Whole page fits it in the window', async ({ page }) => {
  const id = await addPdf(page);
  await page.goto(`/read/${id}`);
  await expect(textLayer(page, 1)).not.toBeEmpty();
  const uncropped = await boxOf(slot(page, 1));

  await openSettings(page);
  await cropOption(page).check();
  await expectCropped(page);
  // Fit width: the box is as wide as the whole page was.
  await expect.poll(async () => (await boxOf(slot(page, 1))).width).toBeCloseTo(uncropped.width, 0);

  const fit = settings(page).getByRole('radiogroup', { name: 'Page fit' });
  await fit.getByRole('radio', { name: 'Whole page' }).click();
  await closeSettings(page);
  const viewHeight = await slot(page, 1).evaluate((el) => el.closest<HTMLElement>('.overflow-auto')!.clientHeight);
  await expect.poll(async () => (await boxOf(slot(page, 1))).height).toBeLessThanOrEqual(viewHeight);
  const whole = await boxOf(slot(page, 1));
  // The box takes all the height or all the width there is.
  expect(Math.max(whole.height / viewHeight, whole.width / uncropped.width)).toBeGreaterThan(0.98);
  await expectCropped(page);

  await page.getByRole('button', { name: 'Fit to width' }).click();
  await expect.poll(async () => (await boxOf(slot(page, 1))).width).toBeCloseTo(uncropped.width, 0);
});

test('with the crop, the zoom is still the size of the page itself and − and + step from it', async ({
  page,
}, testInfo) => {
  const id = await addPdf(page);
  await page.goto(`/read/${id}`);
  await expect(textLayer(page, 1)).not.toBeEmpty();
  // The fixture's pages are 612pt wide: 816 CSS pixels at 100%.
  const zoomOf = async () => (await boxOf(pdfPage(page, 1))).width / 816;
  const fittedWhole = await zoomOf();

  await openSettings(page);
  await cropOption(page).check();
  await closeSettings(page);
  await expectCropped(page);
  const share = await slotShare(page, 1);
  const fitted = await zoomOf();
  expect(fitted).toBeCloseTo(fittedWhole / share, 1);
  const shown = page.getByRole('navigation', { name: 'Page controls' }).getByText(/^\d+%$/);
  // The percentage is hidden on a phone.
  const desktop = testInfo.project.name === 'desktop';
  if (desktop) await expect(shown).toHaveText(`${Math.round(fitted * 100)}%`);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(zoomOf).toBeGreaterThan(fitted + 0.01);
  const zoomed = await zoomOf();
  if (desktop) await expect(shown).toHaveText(`${Math.round(zoomed * 100)}%`);
  // Still cropped, by the same share.
  expect(await slotShare(page, 1)).toBeCloseTo(share, 2);

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(zoomOf).toBeLessThan(fitted - 0.01);
  expect(await slotShare(page, 1)).toBeCloseTo(share, 2);
  await expect(pageInput(page)).toHaveValue('1');

  await page.getByRole('button', { name: 'Fit to width' }).click();
  await expect.poll(zoomOf).toBeCloseTo(fitted, 2);
});

test('a saved highlight stays on its words when the crop comes on, and a tap still opens it', async ({ page }) => {
  const id = await addPdf(page);
  await page.goto(`/read/${id}`);
  await expect(textLayer(page, 1)).not.toBeEmpty();
  const words = 'Page 1 of the margins book.';
  await dragOver(page, 1, words);
  await menu(page).getByRole('button', { name: 'Highlight green' }).click();
  const note = pdfPage(page, 1).locator('[data-highlight-kind="note"]');
  await expect(note).toHaveCount(1);
  await expectHighlightOnWords(page, 1, words);

  await openSettings(page);
  await cropOption(page).check();
  await closeSettings(page);
  await expectCropped(page);
  await expectHighlightOnWords(page, 1, words);

  const mark = await boxOf(note);
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true');
});

test('a selection made with the crop on is saved on its words, with or without the crop', async ({ page }) => {
  const id = await addPdf(page);
  await openCropped(page, id);
  await expectCropped(page);
  const words = 'Middle of page 1.';
  await dragOver(page, 1, words);
  await expect(menu(page)).toBeVisible();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/highlights') && r.request().method() === 'POST');
  await menu(page).getByRole('button', { name: 'Highlight yellow' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const saved = (response.request().postDataJSON() as { selection: { text: string; anchor: { page: number; rects: { x: number }[] } } })
    .selection;
  expect(saved.text).toContain(words);
  expect(saved.anchor.page).toBe(1);
  // The rects are shares of the whole page, not of the box: the text block starts 100pt into a 612pt page.
  expect(saved.anchor.rects[0].x).toBeCloseTo(100 / 612, 2);
  await expectHighlightOnWords(page, 1, words);

  await page.reload();
  await expectCropped(page);
  await expectHighlightOnWords(page, 1, words);

  await openSettings(page);
  await cropOption(page).uncheck();
  await closeSettings(page);
  await expect.poll(() => slotShare(page, 1)).toBeCloseTo(1, 2);
  await expectHighlightOnWords(page, 1, words);
});

test('with the crop, a link to a highlight opens on its page, and a click in the list shows the highlight', async ({
  page,
}, testInfo) => {
  const id = await addPdf(page);
  // "Middle of page 9." is the sixteenth line: its baseline is 390pt up a 792pt page.
  const rect = { x: 100 / 612, y: (792 - 390 - 10) / 792, w: 0.16, h: 13 / 792 };
  const anchor = await addNote(page, id, 9, 'Middle of page 9.', rect);
  await addNote(page, id, 3, 'Middle of page 3.', rect);

  await openCropped(page, id, `?at=${encodeURIComponent(JSON.stringify(anchor))}`);
  await expectCropped(page, 9);
  await expect(pageInput(page)).toHaveValue('9');
  // The pages changed size when the box was found; page 9 is still the one at the top.
  await expect.poll(() => slotTopInView(page, 9)).toBeLessThan(1);
  await expectHighlightOnWords(page, 9, 'Middle of page 9.');
  await expect(pageInput(page)).toHaveValue('9');

  await page.getByRole('button', { name: 'Highlights and threads' }).click();
  await page
    .getByRole('complementary', { name: 'In this book' })
    .getByRole('link', { name: /Middle of page 3/ })
    .click();
  await expect(pageInput(page)).toHaveValue('3');
  // A side panel made the column narrower on a wide window; wait for the page to be fitted again.
  if (testInfo.project.name === 'desktop') await expectCropped(page, 3);
  // The highlight is a third of the way down the view, wherever the box put it on the page.
  const mark = pdfPage(page, 3).locator('[data-highlight-kind="note"]');
  const offset = () =>
    mark.evaluate((el) => {
      const view = el.closest<HTMLElement>('.overflow-auto')!;
      return (el.getBoundingClientRect().top - view.getBoundingClientRect().top) / view.clientHeight;
    });
  await expect(mark).toHaveCount(1);
  await expect.poll(offset).toBeCloseTo(1 / 3, 1);
});

test('a page the box would cut is shown whole in its slot, and turning pages works as before', async ({ page }) => {
  const id = await addPdf(page);
  await openCropped(page, id);
  await expectCropped(page);
  const window = await boxOf(slot(page, 1));

  for (const n of CUT_PAGES) {
    await pageInput(page).fill(String(n));
    await pageInput(page).press('Enter');
    await expect(textLayer(page, n)).not.toBeEmpty();
    // All of the page is inside its slot, and the slot is the size of every other.
    await expect.poll(async () => shareInside(await boxOf(pdfPage(page, n)), await boxOf(slot(page, n)))).toBeGreaterThan(0.999);
    const own = await boxOf(slot(page, n));
    expect(own.width).toBeCloseTo(window.width, 0);
    expect(own.height).toBeCloseTo(window.height, 0);
    // The stamp in page 4's margin is there to read.
    if (n === 4) expect(await shareInside(await textBox(page, 4, 'Stamped in the margin'), own)).toBeGreaterThan(0.99);
  }

  // The page after one shown whole is cropped as usual.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageInput(page)).toHaveValue('9');
  await expectCropped(page, 9);
  await expect.poll(() => slotTopInView(page, 9)).toBeLessThan(1);
  await page.keyboard.press('ArrowLeft');
  await expect(pageInput(page)).toHaveValue('8');
  await expect.poll(() => slotTopInView(page, 8)).toBeLessThan(1);
});

/** The element the pages scroll in. */
const scrollerOf = (page: Page) =>
  slot(page, 1).evaluateHandle((el) => el.closest<HTMLElement>('.overflow-auto')!);

const slotOffsetTop = (scroller: JSHandle<HTMLElement>, n: number) =>
  scroller.evaluate((el, n) => el.querySelector<HTMLElement>(`[data-slot="${n}"]`)!.offsetTop, n);

/** Wheels down by `delta` px in notches of at most 100 px, and waits for the view to stop moving. */
async function wheelAndRest(page: Page, scroller: JSHandle<HTMLElement>, delta: number) {
  const box = (await scroller.asElement()!.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let left = delta; left > 0; left -= 100) {
    await page.mouse.wheel(0, Math.min(left, 100));
    await page.waitForTimeout(60);
  }
  let last = -1;
  await expect
    .poll(async () => {
      const now = await scroller.evaluate((el) => el.scrollTop);
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

test('with the crop, Next page glides to the top of the next slot, naming the page at once', async ({ page }) => {
  const id = await addPdf(page);
  await openCropped(page, id);
  await expectCropped(page);
  const scroller = await scrollerOf(page);
  const target = await slotOffsetTop(scroller, 2);
  // The view's scrollTop and the current page on every frame.
  const frames = await scroller.evaluateHandle((el) => {
    const seen: { top: number; current: number }[] = [];
    const sample = () => {
      seen.push({ top: el.scrollTop, current: Number(el.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.slot) });
      frame = requestAnimationFrame(sample);
    };
    let frame = requestAnimationFrame(sample);
    return {
      stop: () => {
        cancelAnimationFrame(frame);
        return seen;
      },
    };
  });

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageInput(page)).toHaveValue('2');
  await expect.poll(() => slotTopInView(page, 2)).toBeLessThan(1);
  const seen = await frames.evaluate((f) => f.stop());
  expect(seen.some((f) => f.top > 0 && f.top < target && f.current === 2)).toBe(true);
  const pages = seen.map((f) => f.current);
  expect(pages).toEqual([...pages].sort((a, b) => a - b));
  // It stays there: nothing pulls the view back or on.
  await page.waitForTimeout(400);
  expect(await slotTopInView(page, 2)).toBeLessThan(1);
  await expect(pageInput(page)).toHaveValue('2');
});

test('with the crop, a hand scroll is followed in Fit width and settles onto a page top in Whole page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Whole page settles are checked on a wide window');
  const id = await addPdf(page);
  await openCropped(page, id);
  await expectCropped(page);
  const scroller = await scrollerOf(page);

  // Fit width: the view stays where the wheel put it, and the page number follows it.
  const third = await slotOffsetTop(scroller, 3);
  await wheelAndRest(page, scroller, third - 40);
  await page.waitForTimeout(800);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(third - 40);
  await expect(pageInput(page)).toHaveValue('3');

  // Whole page: a scroll that stops just short of a page top comes to rest on it.
  await page.getByRole('button', { name: 'Fit to page' }).click();
  await expect.poll(() => slotTopInView(page, 3)).toBeLessThan(1);
  const viewHeight = await scroller.evaluate((el) => el.clientHeight);
  expect((await boxOf(slot(page, 3))).height).toBeLessThanOrEqual(viewHeight);
  // One page's distance, as a longer scroll would be drawn onto each page top it stops near on the way.
  const from = await scroller.evaluate((el) => el.scrollTop);
  const fourth = await slotOffsetTop(scroller, 4);
  await wheelAndRest(page, scroller, fourth - 40 - from);
  await expect.poll(() => slotTopInView(page, 4)).toBeLessThan(1);
  await page.waitForTimeout(500);
  expect(await slotTopInView(page, 4)).toBeLessThan(1);
  await expect(pageInput(page)).toHaveValue('4');
});

test('a book whose text already reaches the edges is shown as without the option', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const sheet = doc.addPage([612, 792]);
    sheet.drawRectangle({ x: 12, y: 100, width: 588, height: 600 });
  }
  const id = await addPdf(page, await doc.save());
  await openCropped(page, id);
  await expect(pdfPage(page, 1).locator('canvas')).toBeVisible();
  // Long enough for the box to have been found (it takes well under a second for two pages).
  await page.waitForTimeout(1500);
  expect(await slotShare(page, 1)).toBeCloseTo(1, 2);
  await openSettings(page);
  await expect(cropOption(page)).toBeChecked();
});

const savedBox = (page: Page, id: string) => page.evaluate((id) => localStorage.getItem(`hmr.pdfCrop.${id}`), id);

test('on the first open with the option on, the pages appear already cropped, not at one size then another', async ({
  page,
}) => {
  const id = await addPdf(page);
  // The share of page 1 its slot shows the first moment the slot is there.
  await page.addInitScript(() => {
    const w = window as unknown as { firstShare?: number };
    new MutationObserver((_, observer) => {
      const slot = document.querySelector('[data-slot="1"]');
      const sheet = slot?.querySelector('.react-pdf__Page');
      if (!slot || !sheet) return;
      w.firstShare = slot.getBoundingClientRect().width / sheet.getBoundingClientRect().width;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await openCropped(page, id);
  await expectCropped(page);
  const first = await page.evaluate(() => (window as unknown as { firstShare?: number }).firstShare);
  expect(first).toBeDefined();
  expect(first!).toBeCloseTo(await slotShare(page, 1), 2);
});

test('the box is remembered per book: a second open is cropped at once, without looking for the box again', async ({
  page,
}) => {
  const id = await addPdf(page);
  await openCropped(page, id);
  await expectCropped(page);
  await expect.poll(() => savedBox(page, id)).not.toBeNull();
  const found = JSON.parse((await savedBox(page, id))!) as { box: { l: number; t: number; r: number; b: number } };

  // A box a little wider than the one found, stored in its place: the reader can only show it if it
  // uses the stored box, and a new search would store the found one again.
  const { l, t, r, b } = found.box;
  const wider = { l: Math.max(0, l - 0.04), t: Math.max(0, t - 0.04), r: Math.min(1, r + 0.04), b: Math.min(1, b + 0.04) };
  const stored = JSON.stringify({ ...found, box: wider });
  await page.evaluate(([id, stored]) => localStorage.setItem(`hmr.pdfCrop.${id}`, stored), [id, stored]);

  await page.reload();
  await expect(textLayer(page, 1)).not.toBeEmpty();
  await expect.poll(() => slotShare(page, 1)).toBeCloseTo(wider.r - wider.l, 2);
  // Long enough for a search of twelve pages to have finished and stored its box.
  await page.waitForTimeout(1500);
  expect(await savedBox(page, id)).toBe(stored);
  expect(await slotShare(page, 1)).toBeCloseTo(wider.r - wider.l, 2);
});

test('a book not worth cropping is remembered as such', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) doc.addPage([612, 792]).drawRectangle({ x: 12, y: 100, width: 588, height: 600 });
  const id = await addPdf(page, await doc.save());
  await openCropped(page, id);
  await expect(pdfPage(page, 1).locator('canvas')).toBeVisible();
  await expect.poll(() => savedBox(page, id)).toBe(JSON.stringify({ v: 1, box: null }));
  expect(await slotShare(page, 1)).toBeCloseTo(1, 2);
});

test('turning the option on and off keeps the same page current', async ({ page }) => {
  const id = await addPdf(page);
  await page.goto(`/read/${id}`);
  await expect(textLayer(page, 1)).not.toBeEmpty();
  await pageInput(page).fill('5');
  await pageInput(page).press('Enter');
  await expect(textLayer(page, 5)).not.toBeEmpty();
  // Partway down page 5, as a reader would be.
  await slot(page, 5).evaluate((el: HTMLElement) => {
    el.closest<HTMLElement>('.overflow-auto')!.scrollTop += el.offsetHeight / 4;
  });
  await page.waitForTimeout(300);
  await expect(pageInput(page)).toHaveValue('5');

  for (const on of [true, false, true]) {
    await openSettings(page);
    await cropOption(page).setChecked(on);
    await closeSettings(page);
    if (on) await expectCropped(page, 5);
    else await expect.poll(() => slotShare(page, 5)).toBeCloseTo(1, 2);
    await page.waitForTimeout(500);
    await expect(pageInput(page)).toHaveValue('5');
    expect(await slotTopInView(page, 5)).toBeLessThan(2);
  }
});
