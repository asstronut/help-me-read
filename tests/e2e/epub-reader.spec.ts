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

/** Markers (P1, P2, …) whose first characters are on screen right now. */
async function visibleMarkers(page: Page): Promise<string[]> {
  const frame = await chapterFrame(page);
  return frame.evaluate(() => {
    const top = window.top!;
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
      if (left >= 0 && left + r.width <= top.innerWidth && r.top >= 0 && r.bottom <= top.innerHeight)
        seen.push(marker);
    }
    return seen;
  });
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

test('the font size choice applies to the text and survives a reload', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => paragraphFontSize(page)).toBe('18px');

  await page.getByLabel('Font size').selectOption('24');
  await expect.poll(() => paragraphFontSize(page)).toBe('24px');

  await page.reload();
  await expect.poll(() => paragraphFontSize(page)).toBe('24px');
});

test('the page does not scroll sideways', async ({ page }) => {
  const id = await addSampleEpub(page);
  await page.goto(`/read/${id}`);
  await expect.poll(() => visibleMarkers(page)).toContain('P1');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
