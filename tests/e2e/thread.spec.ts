import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/owner.json' });

const SEGMENTS = [
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

const CAP_MESSAGE = "You've reached this month's AI limit of $10.00. Raise it in Settings.";

/** A PDF book with the sample stored and its text already prepared, arranged through the API. */
async function addPreparedPdf(page: Page): Promise<string> {
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
    data: { segments: SEGMENTS, done: true },
  });
  expect(segments.status()).toBe(204);
  return bookId;
}

const textLayer = (page: Page, n: number) =>
  page.locator(`.react-pdf__Page[data-page-number="${n}"] .react-pdf__Page__textContent`);

/** Selects the first occurrence of `text` in a PDF page's text layer, as a user's drag would. */
async function selectPdfText(page: Page, pageNumber: number, text: string) {
  await expect(textLayer(page, pageNumber)).toContainText(text);
  await page.evaluate(
    ({ pageNumber, text }) => {
      const layer = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageNumber}"] .react-pdf__Page__textContent`,
      )!;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const at = nodes.map((n) => n.data).join('').indexOf(text);
      const locate = (offset: number, isEnd: boolean): [Node, number] => {
        for (const node of nodes) {
          if (offset < node.data.length || (isEnd && offset === node.data.length)) return [node, offset];
          offset -= node.data.length;
        }
        throw new Error('offset past the text layer');
      };
      const range = document.createRange();
      range.setStart(...locate(at, false));
      range.setEnd(...locate(at + text.length, true));
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    },
    { pageNumber, text },
  );
}

async function openPdf(page: Page): Promise<string> {
  const bookId = await addPreparedPdf(page);
  await page.goto(`/read/${bookId}`);
  await expect(textLayer(page, 1)).toContainText('steep');
  return bookId;
}

async function pick(page: Page, item: string) {
  await page
    .getByRole('toolbar', { name: 'Selection menu' })
    .getByRole('group', { name: 'Actions' })
    .getByRole('button', { name: item })
    .click();
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Thread' });
const answers = (page: Page) => panel(page).getByRole('article');

/** Opens a Define thread on "Ephemeral" (page 2) and returns its id. */
async function defineEphemeral(page: Page): Promise<string> {
  await selectPdfText(page, 2, 'Ephemeral');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/threads') && r.request().method() === 'POST',
  );
  await pick(page, 'Define');
  const response = await created;
  expect(response.status()).toBe(201);
  return ((await response.json()) as { threadId: string }).threadId;
}

test.beforeEach(async ({ page }) => {
  const { books } = (await (await page.request.get('/api/books')).json()) as {
    books: { id: string }[];
  };
  for (const b of books) await page.request.delete(`/api/books/${b.id}`);
});

test('define answers, takes a follow-up, re-asks with another model and reopens', async ({ page }) => {
  const bookId = await openPdf(page);
  const threadId = await defineEphemeral(page);

  await expect(panel(page)).toBeVisible();
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText('MOCK ANSWER');
  await expect(answers(page).first()).toContainText('Gemini 3.8 Flash');

  await panel(page).getByLabel('Follow-up').fill('More?');
  await panel(page).getByRole('button', { name: 'Send' }).click();
  await expect(panel(page).getByText('More?')).toBeVisible();
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).nth(1)).toContainText('MOCK ANSWER');

  const switcher = panel(page).getByLabel('Model');
  await expect(switcher.locator('option', { hasText: 'Gemini 3.1 Pro' })).toContainText('not tested');
  await expect(switcher.locator('option', { hasText: 'Claude Haiku 5.5' })).not.toContainText(
    'not tested',
  );
  await switcher.selectOption('claude-haiku-5-5');
  await panel(page).getByRole('button', { name: 'Re-ask' }).click();
  await expect(answers(page)).toHaveCount(3);
  await expect(answers(page).nth(2)).toContainText('MOCK ANSWER');
  await expect(answers(page).nth(2)).toContainText('Claude Haiku 5.5');
  await expect(answers(page).nth(1)).toContainText('Gemini 3.8 Flash');

  await page.goto(`/read/${bookId}?thread=${threadId}`);
  await expect(answers(page)).toHaveCount(3);
  await expect(answers(page).nth(2)).toContainText('Claude Haiku 5.5');
  await expect(panel(page).getByText('More?')).toBeVisible();
});

test('Ask with "Use whole book" on creates a whole-book thread', async ({ page }) => {
  await openPdf(page);
  await selectPdfText(page, 2, 'Ephemeral joys fade quickly.');
  await pick(page, 'Ask…');

  const question = panel(page).getByLabel('Question');
  await expect(question).toHaveValue('');
  const wholeBook = panel(page).getByLabel('Use whole book');
  await expect(wholeBook).not.toBeChecked();
  await wholeBook.check();
  await question.fill('Why do they fade?');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/threads') && r.request().method() === 'POST',
  );
  await panel(page).getByRole('button', { name: 'Ask' }).click();
  const { threadId } = (await (await created).json()) as { threadId: string };

  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText('MOCK ANSWER');
  const { thread } = (await (await page.request.get(`/api/threads/${threadId}`)).json()) as {
    thread: { scope: string };
  };
  expect(thread.scope).toBe('book');
});

test('over the spend cap, the panel shows the cap message with a link to Settings', async ({ page }) => {
  await openPdf(page);
  await page.route('**/api/threads/*/chat', (route) =>
    route.fulfill({ status: 402, json: { message: CAP_MESSAGE } }),
  );
  await defineEphemeral(page);

  await expect(panel(page).getByText(CAP_MESSAGE)).toBeVisible();
  await expect(panel(page).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  await expect(answers(page)).toHaveCount(0);
});

test('a failed answer keeps its partial text and Retry completes it', async ({ page }) => {
  await openPdf(page);
  let chatCalls = 0;
  await page.route('**/api/threads/*/chat', (route) => {
    chatCalls += 1;
    const headers = { ...route.request().headers() };
    if (chatCalls === 1) headers['x-test-fail-after'] = '1';
    return route.continue({ headers });
  });
  const threadId = await defineEphemeral(page);

  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText('MOCK');
  await expect(answers(page).first()).not.toContainText('MOCK ANSWER');
  await panel(page).getByRole('button', { name: 'Retry' }).click();
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).nth(1)).toContainText('MOCK ANSWER');
  await expect(panel(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);

  const { messages } = (await (await page.request.get(`/api/threads/${threadId}`)).json()) as {
    messages: { status: string }[];
  };
  expect(messages.map((m) => m.status)).toEqual(['failed', 'complete']);
});

test('the panel is a right side panel on desktop and a bottom sheet on a phone', async ({
  page,
}, testInfo) => {
  await openPdf(page);
  await defineEphemeral(page);
  await expect(answers(page).first()).toContainText('MOCK ANSWER');

  const box = (await panel(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  if (testInfo.project.name === 'phone') {
    expect(box.width).toBe(viewport.width);
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - viewport.height * 0.7)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  } else {
    expect(box.width).toBe(420);
    expect(box.x + box.width).toBe(viewport.width);
    expect(box.height).toBe(viewport.height);
    // The panel sits beside the book: the page reflows left of it instead of hiding under it.
    const pdfPage = page.locator('.react-pdf__Page[data-page-number="2"]');
    await expect
      .poll(async () => {
        const p = (await pdfPage.boundingBox())!;
        return p.x + p.width;
      })
      .toBeLessThanOrEqual(box.x);
  }

  await panel(page).getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toHaveCount(0);
});

test('the panel follows the dark theme', async ({ page }) => {
  const settings = { explanationLanguage: 'English', actionModels: {}, monthlyCapUsd: 10 };
  // Theme belongs to the shared owner, so the light default is handed back afterwards.
  await page.request.put('/api/settings', { data: { ...settings, theme: 'dark' } });
  try {
    await openPdf(page);
    await defineEphemeral(page);
    await expect(answers(page).first()).toContainText('MOCK ANSWER');
    const background = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe('rgb(255, 255, 255)');
  } finally {
    await page.request.put('/api/settings', { data: { ...settings, theme: 'light' } });
  }
});

/**
 * Lets the chat request reach the server with the mock failing at once, but drops the stream's
 * `start` chunk, so the browser sees an error before any answer starts. The server has still
 * saved an empty failed answer (and the question, for a follow-up).
 */
async function failBeforeStart(page: Page) {
  let calls = 0;
  await page.route('**/api/threads/*/chat', async (route) => {
    calls += 1;
    if (calls > 1) return route.continue();
    const headers = { ...route.request().headers(), 'x-test-fail-after': '0' };
    const response = await route.fetch({ headers });
    const body = (await response.text())
      .split('\n\n')
      .filter((event) => !event.includes('"type":"start"'))
      .join('\n\n');
    return route.fulfill({ response, body });
  });
}

test('an answer that fails before it starts shows the saved failed answer with Retry', async ({
  page,
}) => {
  await openPdf(page);
  await failBeforeStart(page);
  await defineEphemeral(page);

  await expect(answers(page)).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Retry' }).click();
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).nth(1)).toContainText('MOCK ANSWER');
});

test('a follow-up that fails before it starts keeps its question once', async ({ page }) => {
  await openPdf(page);
  const threadId = await defineEphemeral(page);
  await expect(answers(page).first()).toContainText('MOCK ANSWER');

  await failBeforeStart(page);
  await panel(page).getByLabel('Follow-up').fill('More?');
  await panel(page).getByRole('button', { name: 'Send' }).click();
  await expect(answers(page)).toHaveCount(2);
  await expect(panel(page).getByText('More?')).toHaveCount(1);
  await expect(panel(page).getByLabel('Follow-up')).toHaveValue('');
  await panel(page).getByRole('button', { name: 'Retry' }).click();
  await expect(answers(page)).toHaveCount(3);
  await expect(answers(page).nth(2)).toContainText('MOCK ANSWER');

  const { messages } = (await (await page.request.get(`/api/threads/${threadId}`)).json()) as {
    messages: { role: string; content: string }[];
  };
  expect(messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['More?']);
});

test('a thread that cannot be loaded says so', async ({ page }) => {
  const bookId = await openPdf(page);
  const threadId = await defineEphemeral(page);
  await expect(answers(page).first()).toContainText('MOCK ANSWER');

  await page.route(`**/api/threads/${threadId}`, (route) =>
    route.fulfill({ status: 500, body: 'Internal Server Error' }),
  );
  await page.goto(`/read/${bookId}?thread=${threadId}`);
  await expect(panel(page).getByText('Could not load this thread.')).toBeVisible();
});
