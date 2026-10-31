import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { MAX_UPLOAD_BYTES } from '../../src/lib/types';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SAMPLE_PDF = 'tests/fixtures/sample.pdf';
const SAMPLE_EPUB = 'tests/fixtures/sample.epub';

let tmp: string;
test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hmr-'));
});
test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test.beforeEach(async ({ page }) => {
  // clean slate: remove books left by earlier runs
  const res = await page.request.get('/api/books');
  const { books } = (await res.json()) as { books: { id: string }[] };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
  await page.goto('/library');
  await expect(page.getByText('No books yet')).toBeVisible(); // library has loaded
});

function bookRequests(page: import('@playwright/test').Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}
const touchesBooksOrStorage = (urls: string[]) =>
  urls.filter((u) => u.includes('/api/books') || u.includes('/storage/'));

test('uploading a PDF shows it with its title and author, and it can be deleted', async ({
  page,
}) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Test Author');

  await row.getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Book' })).toHaveCount(0);
});

test('uploading an EPUB reads its title and author', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_EPUB);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Test Author');
});

test('a file over 50 MB is refused before any request', async ({ page }) => {
  const urls = bookRequests(page);
  const big = join(tmp, 'huge.pdf');
  const buf = Buffer.alloc(MAX_UPLOAD_BYTES + 1024 * 1024);
  buf.write('%PDF-1.4\n');
  writeFileSync(big, buf);

  await page.getByLabel('Choose a book').setInputFiles(big);
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This file is larger than 50 MB, the current limit.' }),
  ).toBeVisible();
  expect(touchesBooksOrStorage(urls)).toEqual([]);
});

test('a text file renamed to .pdf is refused', async ({ page }) => {
  const urls = bookRequests(page);
  const fake = join(tmp, 'fake.pdf');
  writeFileSync(fake, 'just some text, not a pdf');

  await page.getByLabel('Choose a book').setInputFiles(fake);
  await expect(
    page.getByRole('alert').filter({ hasText: "This file doesn't look like a real PDF or EPUB." }),
  ).toBeVisible();
  expect(touchesBooksOrStorage(urls)).toEqual([]);
});

test('an unsupported extension is refused', async ({ page }) => {
  const mobi = join(tmp, 'a.mobi');
  writeFileSync(mobi, 'BOOKMOBI');
  await page.getByLabel('Choose a book').setInputFiles(mobi);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Only PDF and EPUB files are supported.' }),
  ).toBeVisible();
});

test('the library has no horizontal scroll', async ({ page }) => {
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Book' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
