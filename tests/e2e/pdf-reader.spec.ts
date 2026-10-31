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
const currentPage = (page: Page) => page.locator('[data-page-number]');

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
  await expect(page.locator('.react-pdf__Page__textContent')).toContainText('bank');
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
});

test('hiding the tab saves the position immediately', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  await pageInput(page).fill('3');
  await pageInput(page).press('Enter');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(async () => (await (await page.request.get(`/api/books/${id}/position`)).json()).location)
    .toEqual({ page: 3 });

  await page.reload();
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '3');
});

test('zoom buttons change the page size and fit-to-width restores it', async ({ page }) => {
  const id = await addSamplePdf(page);
  await page.goto(`/read/${id}`);
  const box = async () => (await page.locator('.react-pdf__Page').boundingBox())!.width;
  await expect(page.locator('.react-pdf__Page canvas')).toBeVisible();
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
  await expect(page.locator('.react-pdf__Page canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
