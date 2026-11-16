import { readFileSync } from 'node:fs';
import { expect, test, type JSHandle, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SAMPLE_PDF = 'tests/fixtures/sample.pdf';
// Six pages, so a scroll can cross several page boundaries.
const CONTENTS_PDF = 'tests/fixtures/contents.pdf';

/** Creates a book with a PDF stored (the sample by default), without going through the library UI. */
async function addSamplePdf(page: Page, fixture = SAMPLE_PDF): Promise<string> {
  const created = await page.request.post('/api/books', {
    data: { title: 'Sample Book', author: null, format: 'pdf', sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as {
    bookId: string;
    signedUploadUrl: string;
  };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: readFileSync(fixture),
  });
  expect(put.ok).toBe(true);
  return bookId;
}

const pageInput = (page: Page) => page.getByLabel('Page number');
const currentPage = (page: Page) => page.locator('[aria-current="page"] [data-page-number]');

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string }[];
  };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

test('the library title opens the reader on the first page', async ({ page }) => {
  await addSamplePdf(page);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Sample Book' }).click();
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/);
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '1');
  await expect(pageInput(page)).toHaveValue('1');
  await expect(currentPage(page).locator('.react-pdf__Page__textContent')).toContainText('bank');
});

test('the toolbar moves between pages and the reader returns to the saved page', async ({
  page,
}) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(pageInput(page)).toHaveValue('1');

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');
  await page.waitForTimeout(2500);

  await page.reload();
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');
  await expect(pageInput(page)).toHaveValue('2');

  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(pageInput(page)).toHaveValue('1');
});

test('going back to the library and opening the book again shows the page it was left on', async ({ page }) => {
  await addSamplePdf(page, CONTENTS_PDF);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Sample Book' }).click();
  await pageInput(page).fill('4');
  await pageInput(page).press('Enter');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '4');

  // The reader stays mounted, hidden, while the library shows, and its PDF is reloaded on the way back.
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole('link', { name: 'Library' }).click();
    await page.getByRole('link', { name: 'Sample Book' }).first().click();
    await expect(pageInput(page)).toHaveValue('4');
    await expect(page.locator('[data-slot="4"] canvas')).toBeInViewport({ ratio: 0.5 });
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('typing a page number jumps to it', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await pageInput(page).fill('3');
  await pageInput(page).press('Enter');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');
  await expect(currentPage(page)).toBeInViewport({ ratio: 0.5 });
});

test('the keyboard turns pages, but not while typing a page number', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(currentPage(page).locator('canvas')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');
  await page.keyboard.press('PageDown');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');
  await page.keyboard.press('Shift+Space');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '1');
  await page.keyboard.press('Space');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');

  // In the page number field the keys move the caret instead.
  await pageInput(page).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(500);
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');
});

test('the progress footer shows the page as a share of the page count', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  const progress = page.getByRole('progressbar', { name: 'Reading progress' });
  await expect(progress).toHaveAttribute('aria-valuenow', '33');
  await expect(page.getByText('33%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '67');
});

test('scrolling down the pages moves the current page', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '1');
  await page.locator('[data-page-number="2"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(pageInput(page)).toHaveValue('2');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '2');
});

test('hiding the tab saves the position immediately', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await pageInput(page).fill('3');
  await pageInput(page).press('Enter');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');

  // the 2 s save timer is still running, so a request this soon can only come from the flush
  const saved = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().endsWith(`/api/books/${id}/position`),
    { timeout: 1000 },
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // 3 of 3 pages; the PDF has no bookmarks, so no chapter covers the page and the save clears it
  expect(JSON.parse((await saved).postData() ?? '{}')).toEqual({ page: 3, progress: 1, chapter: null });
  await expect
    .poll(async () => (await (await page.request.get(`/api/books/${id}/position`)).json()).location)
    .toEqual({ page: 3 });

  await page.reload();
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');
});

test('a failed save is shown and retried until it goes through', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(pageInput(page)).toHaveValue('1');

  await page.route('**/api/books/*/position', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500 }) : route.continue(),
  );
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Progress not saved')).toBeVisible();

  await page.unroute('**/api/books/*/position');
  await expect(page.getByText('Progress not saved')).toHaveCount(0, { timeout: 8000 });
  await expect
    .poll(async () => (await (await page.request.get(`/api/books/${id}/position`)).json()).location)
    .toEqual({ page: 2 });
});

test('hiding the tab sends the newest page even while an earlier save hangs', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(pageInput(page)).toHaveValue('1');

  let puts = 0;
  await page.route('**/api/books/*/position', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts += 1;
    return puts === 1 ? undefined : route.continue(); // the first save never gets a response
  });
  const first = page.waitForRequest((r) => r.method() === 'PUT');
  await page.getByRole('button', { name: 'Next page' }).click();
  await first;

  await pageInput(page).fill('3');
  await pageInput(page).press('Enter');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');
  const second = page.waitForRequest((r) => r.method() === 'PUT', { timeout: 1000 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(JSON.parse((await second).postData() ?? '{}')).toMatchObject({ page: 3, progress: 1 });
});

/** Fails every PUT to the position endpoint with `status` and counts how many were made. */
async function failPositionSaves(page: Page, status: number): Promise<() => number> {
  let puts = 0;
  await page.route('**/api/books/*/position', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts += 1;
    return route.fulfill({ status });
  });
  return () => puts;
}

test('a failed save stops retrying once the reader is left', async ({ page }) => {
  await addSamplePdf(page);
  await page.goto('/library');
  const putCount = await failPositionSaves(page, 500);
  await page.getByRole('link', { name: 'Sample Book' }).click();
  await expect(pageInput(page)).toHaveValue('1');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Progress not saved')).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('link', { name: 'Sample Book' })).toBeVisible();
  await page.waitForTimeout(500);
  const afterLeaving = putCount();
  // an orphaned saver would retry after its backed-off delay (8 s here)
  await page.waitForTimeout(9000);
  expect(putCount()).toBe(afterLeaving);
});

test('being signed out stops saving and says so', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(pageInput(page)).toHaveValue('1');
  const putCount = await failPositionSaves(page, 401);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Signed out — progress not saved')).toBeVisible();

  const afterFirst = putCount();
  expect(afterFirst).toBeGreaterThan(0);
  await page.waitForTimeout(5000);
  expect(putCount()).toBe(afterFirst);
});

test('zoom buttons change the page size and fit-to-width restores it', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  const box = async () => (await currentPage(page).boundingBox())!.width;
  await expect(currentPage(page).locator('canvas')).toBeVisible();
  const fitted = await box();

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(box).toBeGreaterThan(fitted + 10);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(box).toBeLessThan(fitted - 10);
  await page.getByRole('button', { name: 'Fit to width' }).click();
  await expect.poll(box).toBeCloseTo(fitted, -1);
});

test('the page never scrolls sideways on a phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await expect(currentPage(page).locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

/** The element the pages scroll in. */
const scrollerOf = (page: Page) =>
  page.locator('[data-slot="1"]').evaluateHandle((slot) => slot.closest<HTMLElement>('.overflow-auto')!);

test('a page change while scrolling by hand neither hides the reader nor moves the view', async ({ page }) => {
  const id = await addSamplePdf(page, CONTENTS_PDF);
  await page.goto(`/read/${id}`);
  await expect(currentPage(page).locator('canvas')).toBeVisible();
  const scroller = await scrollerOf(page);
  const box = (await scroller.asElement()!.boundingBox())!;

  // A loading page used to hide the whole reader for a frame, which put the view back at the top of the page.
  const narrowest = await scroller.evaluateHandle((el) => {
    let width = el.clientWidth;
    const sample = () => {
      width = Math.min(width, el.clientWidth);
      frame = requestAnimationFrame(sample);
    };
    let frame = requestAnimationFrame(sample);
    return {
      stop: () => {
        cancelAnimationFrame(frame);
        return width;
      },
    };
  });

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const notches = 14;
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(60);
  }
  await expect(pageInput(page)).not.toHaveValue('1');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBeCloseTo(notches * 100, -0.5);
  await page.waitForTimeout(300);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(notches * 100, -0.5);
  expect(await narrowest.evaluate((n) => n.stop())).toBeGreaterThan(0);
});

test('a PDF that cannot be fetched says so', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 500 }));
  await page.goto(`/read/${id}`);
  await expect(page.getByText('Could not open this PDF.')).toBeVisible();
});

/** Wheels down by `delta` px (up when negative) in notches of at most 100 px, and waits for the view to stop moving. */
async function wheelAndRest(page: Page, scroller: JSHandle<HTMLElement>, delta: number) {
  for (let left = Math.abs(delta); left > 0; left -= 100) {
    await page.mouse.wheel(0, Math.sign(delta) * Math.min(left, 100));
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

/** Which slots are drawn: the ones in view must be, and the ones a screen or more away must not be. */
const drawnSlots = (scroller: JSHandle<HTMLElement>) =>
  scroller.evaluate((el) => {
    const view = el.getBoundingClientRect();
    const current = Number(el.querySelector<HTMLElement>('[aria-current="page"]')!.dataset.slot);
    const slots = [...el.querySelectorAll<HTMLElement>('[data-slot]')].map((slot) => {
      const r = slot.getBoundingClientRect();
      const canvas = slot.querySelector('canvas');
      return {
        n: Number(slot.dataset.slot),
        away: Math.max(view.top - r.bottom, r.top - view.bottom, 0),
        hasCanvas: canvas !== null,
        showing: canvas !== null && getComputedStyle(canvas).visibility !== 'hidden',
      };
    });
    const far = slots.filter((s) => s.away > view.height + 20 && Math.abs(s.n - current) > 1);
    return {
      visibleButBlank: slots.filter((s) => s.away === 0 && !s.showing).map((s) => s.n),
      farButDrawn: far.filter((s) => s.hasCanvas).map((s) => s.n),
      farCount: far.length,
    };
  });

test('pages in view are drawn as the view moves, and pages a screen away are not', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'several pages fit on screen only on a wide window');
  // About 2.3 pages tall at 25%: three show at the top, and the last page is more than a screen away.
  await page.setViewportSize({ width: 1280, height: 700 });
  const id = await addSamplePdf(page, CONTENTS_PDF);
  await page.goto(`/read/${id}`);
  await expect(currentPage(page).locator('canvas')).toBeVisible();
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.getByText('25%', { exact: true })).toBeVisible();
  const scroller = await scrollerOf(page);

  const atTop = () => expect.poll(() => drawnSlots(scroller).then((d) => d.visibleButBlank)).toEqual([]);
  await atTop();
  expect((await drawnSlots(scroller)).farCount).toBeGreaterThan(0);
  expect((await drawnSlots(scroller)).farButDrawn).toEqual([]);

  const box = (await scroller.asElement()!.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const delta of [300, 800, -1200]) {
    await wheelAndRest(page, scroller, delta);
    await expect.poll(() => drawnSlots(scroller).then((d) => d.visibleButBlank)).toEqual([]);
    await expect.poll(() => drawnSlots(scroller).then((d) => d.farButDrawn)).toEqual([]);
  }
  await atTop();
});

/** How far a page's top is from the top of the view, in pixels (a view cannot rest between whole pixels). */
const pageTopInView = (scroller: JSHandle<HTMLElement>, n: number) =>
  scroller.evaluate(
    (el, n) =>
      Math.abs(el.querySelector(`[data-slot="${n}"]`)!.getBoundingClientRect().top - el.getBoundingClientRect().top),
    n,
  );
const expectPageAtTop = (scroller: JSHandle<HTMLElement>, n: number) =>
  expect.poll(() => pageTopInView(scroller, n)).toBeLessThan(1);

/** Records the view's scrollTop and the current page on every frame, until `stop`. */
const watchFrames = (scroller: JSHandle<HTMLElement>) =>
  scroller.evaluateHandle((el) => {
    const frames: { top: number; current: number }[] = [];
    const sample = () => {
      const top = el.scrollTop;
      const current = Number(el.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.slot);
      const last = frames.at(-1);
      if (!last || last.top !== top || last.current !== current) frames.push({ top, current });
      frame = requestAnimationFrame(sample);
    };
    let frame = requestAnimationFrame(sample);
    return {
      stop: () => {
        cancelAnimationFrame(frame);
        return frames;
      },
    };
  });

async function openContentsPdf(page: Page) {
  const id = await addSamplePdf(page, CONTENTS_PDF);
  await page.goto(`/read/${id}`);
  await expect(currentPage(page).locator('canvas')).toBeVisible();
  return scrollerOf(page);
}

test('Next page glides to the top of the next page, and the page number switches at once', async ({ page }) => {
  const scroller = await openContentsPdf(page);
  const frames = await watchFrames(scroller);
  const target = await scroller.evaluate((el) => el.querySelector<HTMLElement>('[data-slot="2"]')!.offsetTop);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageInput(page)).toHaveValue('2');
  await expectPageAtTop(scroller, 2);
  const seen = await frames.evaluate((f) => f.stop());

  // On the way: a view that is part of the way there, with the page already named, and no step back.
  expect(seen.some((f) => f.top > 0 && f.top < target && f.current === 2)).toBe(true);
  const pages = seen.map((f) => f.current);
  expect(pages).toEqual([...pages].sort((a, b) => a - b));
});

test('three quick presses of the right arrow land three pages on', async ({ page }) => {
  const scroller = await openContentsPdf(page);
  const frames = await watchFrames(scroller);
  const target = await scroller.evaluate((el) => el.querySelector<HTMLElement>('[data-slot="4"]')!.offsetTop);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(pageInput(page)).toHaveValue('4');
  await expectPageAtTop(scroller, 4);
  await page.waitForTimeout(400);
  expect(await pageTopInView(scroller, 4)).toBeLessThan(1);
  const seen = await frames.evaluate((f) => f.stop());
  const pages = seen.map((f) => f.current);
  expect(pages).toEqual([...pages].sort((a, b) => a - b));
  expect(pages.at(-1)).toBe(4);
  expect(seen.some((f) => f.top > 0 && f.top < target)).toBe(true);
});

test('with reduced motion a turn cuts straight to the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const scroller = await openContentsPdf(page);
  const frames = await watchFrames(scroller);
  const target = await scroller.evaluate((el) => el.querySelector<HTMLElement>('[data-slot="2"]')!.offsetTop);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expectPageAtTop(scroller, 2);
  await page.waitForTimeout(300);
  const tops = (await frames.evaluate((f) => f.stop())).map((f) => f.top);
  expect(tops).toEqual([0, target]);
});

/** Whole page, as the page bar's Fit to page button leaves it: through the stored preference. */
const inWholePage = (page: Page) => page.addInitScript(() => localStorage.setItem('hmr.pdfFit', 'page'));

async function hoverPages(page: Page, scroller: JSHandle<HTMLElement>) {
  const box = (await scroller.asElement()!.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

const slotTop = (scroller: JSHandle<HTMLElement>, n: number) =>
  scroller.evaluate((el, n) => el.querySelector<HTMLElement>(`[data-slot="${n}"]`)!.offsetTop, n);

test('in Whole page a scroll that stops just short of a page top comes to rest on it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Whole page settles are checked on a wide window');
  await inWholePage(page);
  const scroller = await openContentsPdf(page);
  await hoverPages(page, scroller);
  const second = await slotTop(scroller, 2);
  const notches = Math.floor(second / 100);
  expect(second - notches * 100).toBeGreaterThan(0);
  expect(second - notches * 100).toBeLessThan(80);

  await wheelAndRest(page, scroller, notches * 100);
  await expectPageAtTop(scroller, 2);
  await page.waitForTimeout(500);
  expect(await pageTopInView(scroller, 2)).toBeLessThan(1);
  await expect(pageInput(page)).toHaveValue('2');
});

test('in Whole page one notch from a page top stays where the wheel put it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Whole page settles are checked on a wide window');
  await inWholePage(page);
  const scroller = await openContentsPdf(page);
  await hoverPages(page, scroller);

  await wheelAndRest(page, scroller, 100);
  await page.waitForTimeout(800);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(100);
  await wheelAndRest(page, scroller, -100);
  await page.waitForTimeout(800);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
});

test('in Fit width a scroll that stops just short of a page top is left there', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'compared with Whole page on a wide window');
  const scroller = await openContentsPdf(page);
  await hoverPages(page, scroller);
  const second = await slotTop(scroller, 2);

  await wheelAndRest(page, scroller, second - 40);
  await page.waitForTimeout(800);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(second - 40);
});
