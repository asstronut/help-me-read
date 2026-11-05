import { readFileSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SAMPLE_EPUB = 'tests/fixtures/sample.epub';

/** Creates a book with the sample EPUB stored, without going through the library UI. */
async function addSampleEpub(page: Page): Promise<string> {
  const created = await page.request.post('/api/books', {
    data: { title: 'Sample Book', author: null, format: 'epub', sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as {
    bookId: string;
    signedUploadUrl: string;
  };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/epub+zip' },
    body: readFileSync(SAMPLE_EPUB),
  });
  expect(put.ok).toBe(true);
  return bookId;
}

/** The frame foliate renders the current chapter into. */
async function chapterFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank') ?? null)
    .not.toBeNull();
  return page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank')!;
}

/**
 * Markers (P1, P2, …) whose first characters are on screen right now. None while foliate is
 * replacing the chapter's iframe (a page turn into the next section, or a reload), so a poll
 * looks again rather than failing on the old frame.
 */
async function visibleMarkers(page: Page): Promise<string[]> {
  const frame = await chapterFrame(page);
  const replaced = (e: Error) => {
    if (/Execution context was destroyed|Frame was detached/.test(e.message)) return [];
    throw e;
  };
  return frame.evaluate(() => {
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
    const seen: string[] = [];
    for (const p of document.querySelectorAll('p')) {
      const node = p.firstChild;
      const marker = /^P\d+/.exec(p.textContent ?? '')?.[0];
      if (!node || !marker) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const r = range.getBoundingClientRect();
      const left = r.left + offset.left;
      const top = r.top + offset.top;
      if (left >= view.left && left + r.width <= view.right && top >= view.top && top + r.height <= view.bottom)
        seen.push(marker);
    }
    return seen;
  }).catch(replaced);
}

async function paragraphFontSize(page: Page): Promise<string> {
  const frame = await chapterFrame(page);
  return frame.locator('p').first().evaluate((p) => getComputedStyle(p).fontSize);
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string }[];
  };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

test('the reader returns to the saved position after a reload', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => visibleMarkers(page)).toContain('P1');

  const next = page.getByRole('button', { name: 'Next page' });
  await next.click();
  await next.click();
  await expect.poll(() => visibleMarkers(page)).not.toContain('P1');
  const before = await visibleMarkers(page);
  expect(before.length).toBeGreaterThan(0);
  await page.waitForTimeout(2500);

  await page.reload();
  await expect.poll(() => visibleMarkers(page)).toContain(before[0]);
});

test('the keyboard turns pages, also once the text has been clicked', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => visibleMarkers(page)).toContain('P1');
  // foliate-js ignores a page turn asked for within 100 ms of the previous one.
  const settle = () => page.waitForTimeout(300);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => visibleMarkers(page)).not.toContain('P1');
  await settle();
  await page.keyboard.press('PageUp');
  await expect.poll(() => visibleMarkers(page)).toContain('P1');
  await settle();

  // A click in the text puts the focus inside the chapter's iframe; the keys still work there.
  const frame = await chapterFrame(page);
  await frame.locator('p').first().click();
  await page.keyboard.press('Space');
  await expect.poll(() => visibleMarkers(page)).not.toContain('P1');
});

test('the progress footer follows the position in the book', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  const progress = page.getByRole('progressbar', { name: 'Reading progress' });
  const percent = async () => Number(await progress.getAttribute('aria-valuenow'));
  await expect.poll(percent).toBeGreaterThan(0);
  const first = await percent();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(percent).toBeGreaterThan(first);
  await expect(page.getByText(`${await percent()}%`, { exact: true })).toBeVisible();
});

test('the font size choice applies to the text and survives a reload', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => paragraphFontSize(page)).toBe('18px');

  await page.getByRole('button', { name: 'Reading settings' }).click();
  const size = page.getByRole('group', { name: 'Font size' });
  // 18 → 20 → 22 → 24, the largest.
  for (const shown of ['20 px', '22 px', '24 px']) {
    await size.getByRole('button', { name: 'Larger text' }).click();
    await expect(size.getByRole('status')).toHaveText(shown);
  }
  await expect(size.getByRole('button', { name: 'Larger text' })).toBeDisabled();
  await expect.poll(() => paragraphFontSize(page)).toBe('24px');

  await page.reload();
  await expect.poll(() => paragraphFontSize(page)).toBe('24px');
});

test('the text is set in Literata with a line height of 1.7', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  const frame = await chapterFrame(page);
  await expect(frame.locator('p').first()).toBeVisible();
  const text = await frame.locator('p').first().evaluate(async (p) => {
    await document.fonts.ready;
    const style = getComputedStyle(p);
    return {
      family: style.fontFamily,
      lineHeight: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
      // The font is really there, not just named: the chapter's iframe has its own font list.
      loaded: document.fonts.check(`${style.fontSize} Literata`),
    };
  });
  expect(text.family).toMatch(/^"?Literata"?,/);
  expect(text.lineHeight).toBeCloseTo(1.7, 2);
  expect(text.loaded).toBe(true);
});

test('the page does not scroll sideways', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => visibleMarkers(page)).toContain('P1');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
