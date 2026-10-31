import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const PDF_SEGMENTS = [
  {
    seq: 0,
    label: 'Page 1',
    paragraphs: [
      'She sat on the bank. The bank was steep. She sat on the bank.',
      'The river moved slowly under a pale and ephemeral light. Across the page break',
    ],
  },
  { seq: 1, label: 'Page 2', paragraphs: ['into page two.', 'Ephemeral joys fade quickly.'] },
  { seq: 2, label: 'Page 3', paragraphs: ['Final page.'] },
];

/** A PDF book with its fixture stored and its text prepared, arranged through the API. */
async function addPdf(page: Page): Promise<string> {
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
  const segments = await page.request.post(`/api/books/${bookId}/segments`, {
    data: { segments: PDF_SEGMENTS, done: true },
  });
  expect(segments.status()).toBe(204);
  return bookId;
}

const textLayer = (page: Page, n: number) =>
  page.locator(`.react-pdf__Page[data-page-number="${n}"] .react-pdf__Page__textContent`);
const currentPage = (page: Page) => page.locator('[aria-current="page"] [data-page-number]');
const menu = (page: Page) => page.getByRole('toolbar', { name: 'Selection menu' });

/** Selects `text` in page 1's text layer, as a user's drag would. */
async function selectOnFirstPage(page: Page, text: string) {
  await page.evaluate((text) => {
    const layer = document.querySelector(
      '.react-pdf__Page[data-page-number="1"] .react-pdf__Page__textContent',
    )!;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
      return;
    }
    throw new Error(`"${text}" not on page 1`);
  }, text);
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string }[];
  };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
  const { entries } = (await (await page.request.get('/api/vocab')).json()) as {
    entries: { id: string }[];
  };
  for (const e of entries) await page.request.delete(`/api/vocab/${e.id}`);
});

test('+Vocab saves a word that the vocab page can search, jump to, export and delete', async ({
  page,
}) => {
  const bookId = await addPdf(page);
  await page.goto(`/read/${bookId}`);
  await expect(textLayer(page, 1)).toContainText('steep');
  await selectOnFirstPage(page, 'steep');
  await menu(page).getByRole('button', { name: '+Vocab' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to vocab' })).toBeVisible();
  await expect(menu(page)).toHaveCount(0);

  await page.goto('/vocab');
  const row = page.getByRole('listitem').filter({ hasText: 'steep' });
  await expect(row).toContainText('The bank was steep.');
  await expect(row).toContainText('Sample Book');

  // The book was left on page 3, so landing on page 1 shows the jump used the entry's anchor.
  const saved = await page.request.put(`/api/books/${bookId}/position`, { data: { page: 3 } });
  expect(saved.status()).toBe(204);
  await row.getByRole('link', { name: 'Jump' }).click();
  await expect(page).toHaveURL(new RegExp(`/read/${bookId}\\?at=`));
  await expect(textLayer(page, 1)).toContainText('steep');
  await expect(currentPage(page)).toHaveAttribute('data-page-number', '1');

  await page.goto('/vocab');
  const search = page.getByRole('searchbox', { name: 'Search vocab' });
  await search.fill('zzz');
  await expect(row).toHaveCount(0);
  await search.fill('');
  await expect(row).toHaveCount(1);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const csv = readFileSync(await (await download).path(), 'utf8');
  expect(csv.split('\r\n')[1].startsWith('steep,')).toBe(true);

  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('steep')).toHaveCount(0);
});
