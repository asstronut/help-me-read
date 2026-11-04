import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

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

test('a stored book with no text is prepared when the library is opened', async ({ page }) => {
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

  await page.goto('/library');
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Preparing text…')).toHaveCount(0, { timeout: 30_000 });
  expect((await segment(page, bookId, 0)).label).toBe('Page 1');
});

test('a failed text save shows a retry that finishes the job', async ({ page }) => {
  await page.route('**/api/books/*/segments', (route) => route.fulfill({ status: 500 }));
  await page.getByLabel('Choose a book').setInputFiles(SAMPLE_PDF);
  const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
  await expect(row.getByText("Couldn't prepare text")).toBeVisible({ timeout: 30_000 });

  await page.unroute('**/api/books/*/segments');
  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(row.getByText("Couldn't prepare text")).toHaveCount(0);
  await expect(row.getByText('Preparing text…')).toHaveCount(0, { timeout: 30_000 });
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { extracted: boolean }[];
  };
  expect(books[0].extracted).toBe(true);
});

test('EPUB text in divs, beside nested blocks and around line breaks is kept', async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hmr-epub-'));
  try {
    const file = join(dir, 'mixed.epub');
    writeFileSync(file, await mixedEpub());
    await page.getByLabel('Choose a book').setInputFiles(file);
    const row = page.getByRole('listitem').filter({ hasText: 'Sample Book' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Preparing text…')).toHaveCount(0, { timeout: 30_000 });
    const { books } = (await (await page.request.get('/api/books')).json()) as {
      books: { id: string }[];
    };

    const one = await segment(page, books[0].id, 0);
    expect(one.label).toBe('Mixed');
    expect(one.paragraphs).toEqual([
      'Div paragraph',
      'Intro',
      'x',
      'foo bar',
      'Bare inline text',
      'after',
      'Sub heading',
    ]);
    // a heading that is not just the label stays
    const two = await segment(page, books[0].id, 1);
    expect(two.label).toBe('Two');
    expect(two.paragraphs).toEqual(['Different', 'Body.']);
    // whitespace inside the label and heading is collapsed before comparing; "s" text survives
    const three = await segment(page, books[0].id, 2);
    expect(three.label).toBe('Chapter Three');
    expect(three.paragraphs).toEqual(['Glass mess', 'ss']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function mixedEpub(): Promise<Uint8Array> {
  const page = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>${body}</body></html>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="b"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="b">urn:uuid:1</dc:identifier><dc:title>Sample Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    page(
      '<nav epub:type="toc"><ol><li><a href="c1.xhtml">Mixed</a></li><li><a href="c2.xhtml">Two</a></li><li><a href="c3.xhtml">Chapter\n  Three</a></li></ol></nav>',
    ),
  );
  zip.file(
    'OEBPS/c1.xhtml',
    page(
      '<h1> Mixed </h1><div>Div paragraph</div><ul><li>Intro <p>x</p></li></ul><p>foo<br/>bar</p><section>Bare <em>inline</em> text<p>after</p></section><h2>Sub heading</h2>',
    ),
  );
  zip.file('OEBPS/c2.xhtml', page('<h1>Different</h1><p>Body.</p>'));
  zip.file('OEBPS/c3.xhtml', page('<h1>Chapter   Three</h1><p>Glass mess</p><p>ss</p>'));
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}
