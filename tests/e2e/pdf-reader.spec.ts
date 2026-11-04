import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SAMPLE_PDF = 'tests/fixtures/sample.pdf';

/** Creates a book with the sample PDF stored, without going through the library UI. */
async function addSamplePdf(page: Page): Promise<string> {
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
    body: readFileSync(SAMPLE_PDF),
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

test('typing a page number jumps to it', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await pageInput(page).fill('3');
  await pageInput(page).press('Enter');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');
  await expect(currentPage(page)).toBeInViewport({ ratio: 0.5 });
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
  expect(JSON.parse((await saved).postData() ?? '{}')).toEqual({ page: 3 });
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
  expect(JSON.parse((await second).postData() ?? '{}')).toEqual({ page: 3 });
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
