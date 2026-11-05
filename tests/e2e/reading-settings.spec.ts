import { readFileSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const DEFAULTS = { explanationLanguage: 'English', actionModels: {}, monthlyCapUsd: 10, theme: 'light' };

async function addBook(page: Page, fixture: 'sample.epub' | 'sample.pdf'): Promise<string> {
  const format = fixture.endsWith('.pdf') ? 'pdf' : 'epub';
  const created = await page.request.post('/api/books', {
    data: { title: 'Settings Book', author: null, format, sizeBytes: 100 },
  });
  const { bookId, signedUploadUrl } = (await created.json()) as { bookId: string; signedUploadUrl: string };
  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': format === 'pdf' ? 'application/pdf' : 'application/epub+zip' },
    body: readFileSync(`tests/fixtures/${fixture}`),
  });
  expect(put.ok).toBe(true);
  return bookId;
}

/** The frame foliate renders the current chapter into. */
async function chapterFrame(page: Page): Promise<Frame> {
  const find = () => page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank') ?? null;
  await expect.poll(find).not.toBeNull();
  return find()!;
}

/** How the chapter's first paragraph is set. */
async function paragraph(page: Page) {
  const frame = await chapterFrame(page);
  return frame
    .locator('p')
    .first()
    .evaluate(async (p) => {
      await document.fonts.ready;
      const style = getComputedStyle(p);
      return {
        family: style.fontFamily,
        lineHeight: Math.round((parseFloat(style.lineHeight) / parseFloat(style.fontSize)) * 100) / 100,
        width: Math.round(p.getBoundingClientRect().width),
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Reading settings' });

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await expect(settings(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as { books: { id: string }[] };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

// Theme belongs to the shared owner, so each test hands back the light default.
test.afterEach(async ({ page }) => {
  await page.request.put('/api/settings', { data: DEFAULTS });
});

test('the typeface sets the text in Sans or Atkinson Hyperlegible, and survives a reload', async ({ page }) => {
  const id = await addBook(page, 'sample.epub');
  await page.goto(`/read/${id}`);
  await expect.poll(async () => (await paragraph(page)).family).toMatch(/^"?Literata"?,/);

  await openSettings(page);
  const typeface = settings(page).getByRole('radiogroup', { name: 'Typeface' });
  await expect(typeface.getByRole('radio', { name: 'Literata' })).toBeChecked();
  await typeface.getByRole('radio', { name: 'Sans' }).click();
  await expect.poll(async () => (await paragraph(page)).family).toMatch(/^"?Geist"?,/);

  await typeface.getByRole('radio', { name: 'Atkinson Hyperlegible' }).click();
  await expect.poll(async () => (await paragraph(page)).family).toMatch(/^"?Atkinson Hyperlegible"?,/);
  // The font is really there in the chapter's iframe, not just named.
  const frame = await chapterFrame(page);
  await expect
    .poll(() =>
      frame.locator('p').first().evaluate(async (p) => {
        await document.fonts.load(`${getComputedStyle(p).fontSize} "Atkinson Hyperlegible"`);
        return document.fonts.check(`${getComputedStyle(p).fontSize} "Atkinson Hyperlegible"`);
      }),
    )
    .toBe(true);

  await page.reload();
  await expect.poll(async () => (await paragraph(page)).family).toMatch(/^"?Atkinson Hyperlegible"?,/);
});

test('line spacing sets the line height, and the arrow keys move between the choices', async ({ page }) => {
  const id = await addBook(page, 'sample.epub');
  await page.goto(`/read/${id}`);
  await expect.poll(async () => (await paragraph(page)).lineHeight).toBe(1.7);

  await openSettings(page);
  const spacing = settings(page).getByRole('radiogroup', { name: 'Line spacing' });
  await expect(spacing.getByRole('radio', { name: 'Normal' })).toBeChecked();
  await spacing.getByRole('radio', { name: 'Normal' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(spacing.getByRole('radio', { name: 'Airy' })).toBeChecked();
  await expect.poll(async () => (await paragraph(page)).lineHeight).toBe(1.9);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(spacing.getByRole('radio', { name: 'Tight' })).toBeChecked();
  await expect.poll(async () => (await paragraph(page)).lineHeight).toBe(1.5);
});

test('line width makes the lines narrower or wider', async ({ page }) => {
  const id = await addBook(page, 'sample.epub');
  await page.goto(`/read/${id}`);
  // On a wide window the open contents rail (and the equal space kept on the right) leaves the
  // book about 650px at 1280px, which Medium already fills; fold it to give Wide room.
  const contents = page.getByRole('button', { name: 'Contents' });
  if ((await contents.getAttribute('aria-expanded')) === 'true') await contents.click();
  await expect.poll(async () => (await paragraph(page)).width).toBeGreaterThan(0);
  const medium = (await paragraph(page)).width;

  await openSettings(page);
  const width = settings(page).getByRole('radiogroup', { name: 'Line width' });
  await width.getByRole('radio', { name: 'Narrow' }).click();
  await expect.poll(async () => (await paragraph(page)).width).toBeLessThan(medium);
  await width.getByRole('radio', { name: 'Wide' }).click();
  await expect.poll(async () => (await paragraph(page)).width).toBeGreaterThan(medium);
});

test('the size buttons stop at the smallest size', async ({ page }) => {
  const id = await addBook(page, 'sample.epub');
  await page.goto(`/read/${id}`);
  await openSettings(page);
  const size = settings(page).getByRole('group', { name: 'Font size' });
  await expect(size.getByRole('status')).toHaveText('18 px');
  await size.getByRole('button', { name: 'Smaller text' }).click();
  await size.getByRole('button', { name: 'Smaller text' }).click();
  await expect(size.getByRole('status')).toHaveText('14 px');
  await expect(size.getByRole('button', { name: 'Smaller text' })).toBeDisabled();
});

test('the theme chosen in Aa recolours the book and is saved to the settings', async ({ page }) => {
  const id = await addBook(page, 'sample.epub');
  await page.goto(`/read/${id}`);
  await expect.poll(async () => (await paragraph(page)).background).toBe('rgb(251, 250, 247)');

  await openSettings(page);
  const theme = settings(page).getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked();
  await theme.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect.poll(async () => (await paragraph(page)).background).toBe('rgb(18, 18, 18)');
  await expect
    .poll(async () => ((await (await page.request.get('/api/settings')).json()) as { settings: { theme: string } }).settings.theme)
    .toBe('dark');

  await page.goto('/settings');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('a theme that cannot be saved goes back and says so', async ({ page }) => {
  const id = await addBook(page, 'sample.epub');
  await page.goto(`/read/${id}`);
  await page.route('**/api/settings', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Could not save."}' })
      : route.fallback(),
  );
  await openSettings(page);
  await settings(page).getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Sepia' }).click();
  await expect(settings(page).getByRole('alert')).toHaveText('Could not save.');
  await expect(page.locator('html')).toHaveClass(/\blight\b/);
  await expect(settings(page).getByRole('radio', { name: 'Light' })).toBeChecked();
});

test('a PDF has the theme and its own options in Aa, but no typeface options', async ({ page }) => {
  const id = await addBook(page, 'sample.pdf');
  await page.goto(`/read/${id}`);
  await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible();
  await openSettings(page);
  await expect(settings(page).getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  await expect(settings(page).getByRole('radiogroup', { name: 'Page fit' })).toBeVisible();
  await expect(settings(page).getByRole('radiogroup', { name: 'Typeface' })).toHaveCount(0);
  await expect(settings(page).getByRole('group', { name: 'Font size' })).toHaveCount(0);
});

/** The first page's box, and the visible height of the scrolling column the pages are in. */
async function pdfFit(page: Page) {
  return page.locator('[data-slot="1"]').evaluate((slot) => {
    const scroller = slot.closest<HTMLElement>('.overflow-auto')!;
    return { pageHeight: slot.getBoundingClientRect().height, viewHeight: scroller.clientHeight };
  });
}

test('Whole page fits the PDF page in the window, and Fit to width goes back', async ({ page }) => {
  const id = await addBook(page, 'sample.pdf');
  await page.goto(`/read/${id}`);
  await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible();
  const fitToWidth = page.getByRole('button', { name: 'Fit to width' });
  await expect(fitToWidth).toHaveAttribute('aria-pressed', 'true');

  await openSettings(page);
  const fit = settings(page).getByRole('radiogroup', { name: 'Page fit' });
  await expect(fit.getByRole('radio', { name: 'Fit width' })).toBeChecked();
  await fit.getByRole('radio', { name: 'Whole page' }).click();
  await expect.poll(async () => {
    const { pageHeight, viewHeight } = await pdfFit(page);
    return pageHeight <= viewHeight;
  }).toBe(true);
  await expect(fitToWidth).toHaveAttribute('aria-pressed', 'false');

  // The arrow keys move between the choices and don't turn the page.
  await fit.getByRole('radio', { name: 'Whole page' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(fit.getByRole('radio', { name: 'Fit width' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(fit.getByRole('radio', { name: 'Whole page' })).toBeChecked();
  await expect(page.getByLabel('Page number')).toHaveValue('1');

  await page.reload();
  await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible();
  const { pageHeight, viewHeight } = await pdfFit(page);
  expect(pageHeight).toBeLessThanOrEqual(viewHeight);

  await fitToWidth.click();
  await expect(fitToWidth).toHaveAttribute('aria-pressed', 'true');
  // On a phone the screen's width already limits the page, so both fits are the same size there.
  if (page.viewportSize()!.width >= 640) {
    await expect.poll(async () => (await pdfFit(page)).pageHeight).toBeGreaterThan(pageHeight);
  }
  await openSettings(page);
  await expect(fit.getByRole('radio', { name: 'Fit width' })).toBeChecked();
});

test('Keep PDF colours in Dark stops the page being inverted', async ({ page }) => {
  await page.request.put('/api/settings', { data: { ...DEFAULTS, theme: 'dark' } });
  const id = await addBook(page, 'sample.pdf');
  await page.goto(`/read/${id}`);
  const canvas = page.locator('.react-pdf__Page canvas').first();
  // The highlight tints are screened onto an inverted (black) page, and multiplied onto white paper.
  const tints = page.locator('.react-pdf__Page [class~="mix-blend-multiply"]').first();
  await expect(canvas).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)');
  await expect(tints).toHaveCSS('mix-blend-mode', 'screen');

  await openSettings(page);
  const keep = settings(page).getByRole('checkbox', { name: 'Keep PDF colours in Dark' });
  await expect(keep).not.toBeChecked();
  await keep.check();
  await expect(canvas).toHaveCSS('filter', 'none');
  await expect(tints).toHaveCSS('mix-blend-mode', 'multiply');

  await page.reload();
  await expect(canvas).toHaveCSS('filter', 'none');
});
