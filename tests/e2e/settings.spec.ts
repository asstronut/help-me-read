import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { OWNER, adminClient, userId } from '../helpers/users';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const DEFAULTS = { explanationLanguage: 'English', actionModels: {}, monthlyCapUsd: 10, theme: 'light' };

// Theme belongs to the shared owner, so each test hands back the light default.
test.afterEach(async ({ page }) => {
  await page.request.put('/api/settings', { data: DEFAULTS });
});

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
    body: readFileSync('tests/fixtures/sample.pdf'),
  });
  expect(put.ok).toBe(true);
  return bookId;
}

test('the library links to settings, which show the spend as $X.XX of $Y.YY', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText(/^\$\d+\.\d\d of \$10\.00 this month$/)).toBeVisible();
});

test('choosing dark persists across a reload and inverts the PDF canvas', async ({ page }) => {
  const bookId = await addSamplePdf(page);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);

  await page.goto(`/read/${bookId}`);
  const canvas = page.locator('.react-pdf__Page canvas').first();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)');

  await page.request.delete(`/api/books/${bookId}`);
});

test('the settings page does not scroll sideways', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('signing in through the form shows the saved theme without a reload', async ({ page, browser, baseURL }) => {
  await page.request.put('/api/settings', { data: { ...DEFAULTS, theme: 'dark' } });
  const fresh = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const login = await fresh.newPage();
    await login.goto('/login');
    await expect(login.locator('html')).toHaveClass(/\blight\b/);
    await login.getByLabel('Email').fill(OWNER.email);
    await login.getByLabel('Password').fill(OWNER.password);
    await login.getByRole('button', { name: 'Sign in' }).click();
    await expect(login).toHaveURL(/\/library$/, { timeout: 60_000 });
    await expect(login.locator('html')).toHaveClass(/\bdark\b/);
  } finally {
    await fresh.close();
  }
});

test('a stored model that is no longer available is dropped, so settings still save', async ({ page }) => {
  const admin = adminClient();
  const { error } = await admin
    .from('settings')
    .upsert({ owner_id: await userId(OWNER.email), action_models: { define: 'retired-model-9' } });
  expect(error).toBeNull();

  await page.goto('/settings');
  await page.getByLabel('Explanation language').fill('French');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  const body = (await (await page.request.get('/api/settings')).json()) as {
    settings: { explanationLanguage: string; actionModels: object };
  };
  expect(body.settings.explanationLanguage).toBe('French');
  expect(body.settings.actionModels).toEqual({});
});
