import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SAMPLE_PDF = 'tests/fixtures/sample.pdf';
const SAMPLE_EPUB = 'tests/fixtures/sample.epub';

type Segment = { seq: number; label: string; paragraphs: string[] };

test.beforeEach(async ({ page }) => {
  const res = await page.request.get('/api/books');
  const { books } = (await res.json()) as { books: { id: string }[] };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
  await page.goto('/library');
  await expect(page.getByText('No books yet')).toBeVisible();
});

/** Uploads a fixture, waits for text preparation to finish, and returns the book id. */
async function upload(page: Page, file: string): Promise<string> {
  await page.getByLabel('Choose a book').setInputFiles(file);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Preparing text…')).toHaveCount(0, { timeout: 30_000 });
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string; extracted: boolean }[];
  };
  expect(books).toHaveLength(1);
  expect(books[0].extracted).toBe(true);
  return books[0].id;
}

async function segment(page: Page, id: string, seq: number) {
  const res = await page.request.get(`/api/books/${id}/segments?seq=${seq}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Segment;
}

test('a PDF is split into page segments with paragraphs and joined hyphenation', async ({
  page,
}) => {
  const id = await upload(page, SAMPLE_PDF);

  const first = await segment(page, id, 0);
  expect(first.label).toBe('Page 1');
  expect(first.paragraphs).toContain('She sat on the bank. The bank was steep. She sat on the bank.');
  expect(first.paragraphs.some((p) => p.includes('ephemeral light.'))).toBe(true);
  expect((await segment(page, id, 1)).paragraphs).toContain('Ephemeral joys fade quickly.');
  expect((await page.request.get(`/api/books/${id}/segments?seq=3`)).status()).toBe(404);
});

test('an EPUB is split into chapter segments labelled from its contents', async ({ page }) => {
  const id = await upload(page, SAMPLE_EPUB);

  const first = await segment(page, id, 0);
  expect(first.label).toBe('One');
  expect(first.paragraphs).toHaveLength(12);
  first.paragraphs.forEach((p, i) => expect(p.startsWith(`P${i + 1} `)).toBe(true));
  const second = await segment(page, id, 1);
  expect(second.label).toBe('Two');
  expect(second.paragraphs).toEqual(['Second chapter text.']);
});
