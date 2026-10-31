# help-me-read v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user web reader for PDF and EPUB with AI translate/define/explain/simplify/ask threads, highlights, vocab and a spend cap.

**Architecture:** One Next.js App Router project on Vercel. Supabase provides Postgres (row-level security by owner), Auth and Storage. Book text is extracted in the browser into segments stored in Postgres; the server builds AI context from those segments and streams answers through the Vercel AI SDK, behind a model registry covering Google, Anthropic, OpenAI and OpenRouter.

**Tech Stack:** Node 24, Next.js 16, React 19, TypeScript (strict), Tailwind 4, `ai` 7 + `@ai-sdk/react` 4, `@ai-sdk/google`/`anthropic`/`openai` 4, `@openrouter/ai-sdk-provider` 3, `@supabase/supabase-js` 2 + `@supabase/ssr`, Supabase CLI (local stack in Docker), `react-pdf` 11 (pdf.js), `foliate-js` 1, Zod 4, Vitest 5, Playwright 1.64.

**Spec:** GitHub issue [asstronut/help-me-read#1](https://github.com/asstronut/help-me-read/issues/1) (canonical), mirrored in `docs/superpowers/specs/2026-10-31-help-me-read-design.md`. Section numbers (§) refer to the mirror.

## Global Constraints

- TypeScript `strict: true`; no `any` in `src/`. Database access uses generated types from `src/lib/supabase/database.types.ts`.
- Shared domain types live in `src/lib/types.ts` (Task 1). Names use the glossary terms (spec §3).
- Max upload: `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`. Accepted formats: `.pdf`, `.epub`.
- Max selection: `MAX_SELECTION_WORDS = 2000`. EPUB page context: `EPUB_CONTEXT_WORDS = 400`. Prefix length: `PREFIX_CHARS = 200`. Segment batch: at most 50 per request.
- Default spend cap: `DEFAULT_MONTHLY_CAP_USD = 10`. Months are UTC calendar months. Token estimate: `Math.ceil(chars / 4)`.
- API keys only in server env: `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. The single allowed login is `ALLOWED_EMAIL`. Nothing secret uses a `NEXT_PUBLIC_` prefix.
- Highlight colours: `yellow`, `green`, `blue`, `pink`. Themes: `light`, `dark`, `sepia`.
- Phone layout works at 375 px wide with no horizontal scroll.
- Library APIs (AI SDK 7, Next 16, react-pdf 11, foliate-js) change between majors: check the installed version's docs for exact call shapes.

## Testing approach (from the spec)

Tests check external behaviour only. Two seams, one fake:

- **Seam 1 — the app's server API.** Vitest tests in `tests/api/` send HTTP requests to a running dev server (`AI_MOCK=1`) on a local Supabase stack, signed in through the app's own login endpoint. They assert on status codes, response bodies and streamed text, rows read back through the API, and the prompt the mock model received. Arranging data that has no API (e.g. seeding spend) may use the service-role client from `tests/helpers/`.
- **Seam 2 — the browser.** Playwright tests in `tests/e2e/` (projects `desktop` 1280×800 and `phone` 375×812), only for behaviour that exists in the browser.
- **The only fake is the AI**: the model registry's mock mode. With `AI_MOCK=1` the server also honours **test controls**, read by one module (Task 1) and ignored otherwise:
  - header `x-test-now: <ISO time>` overrides "now" for spend calculations,
  - header `x-test-fail-after: <n>` makes the mock model error after n text chunks,
  - `GET /api/test/last-prompt` returns the last prompt the mock received (404 when `AI_MOCK` is not `1`).
- No internal function gets a direct unit test. If a helper seems to need one, test the behaviour through the API instead.

## Review Focus

1. **Upload over 50 MB, or a renamed non-PDF/EPUB file** → refused before any network upload, with a readable reason. Pinned in Task 3.
2. **Selected text that appears twice on a page** → the prompt's selected occurrence and the vocab sentence follow the prefix, not the first match. Pinned in Tasks 8 and 12.
3. **Provider error partway through a streamed answer** → partial text saved as `failed`, Retry shown, cost only for reported tokens, thread still reopens. Pinned in Tasks 9 and 10.
4. **Spend exactly at / just under the cap, and the UTC month rollover** → the call that would exceed is refused; at-cap is allowed; spend resets on the 1st (UTC). Pinned in Task 9.
5. **Selection starting on one PDF page and ending on the next** → belongs to the start page; menu opens; highlight draws on the start page only. Pinned in Tasks 7 and 11.

---

### Task 1: Scaffold, test harnesses and test controls

**Files:**
- Create: Next.js app files (`package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`), `src/lib/types.ts`, `src/lib/test-controls.server.ts`, `src/app/api/health/route.ts`, `vitest.config.ts`, `playwright.config.ts`, `tests/helpers/server.ts`, `tests/helpers/api-client.ts`, `tests/api/health.test.ts`, `.env.example`, `.github/workflows/ci.yml`, `supabase/config.toml` (via `npx supabase init`)

**Interfaces:**
- `src/lib/types.ts` exports:
  ```ts
  export type BookFormat = 'pdf' | 'epub';
  export type Rect = { x: number; y: number; w: number; h: number }; // 0..1 of page
  export type Anchor = { format: 'pdf'; page: number; rects: Rect[] } | { format: 'epub'; cfi: string };
  export type ReadingLocation = { page: number } | { cfi: string };
  export type Segment = { seq: number; label: string; paragraphs: string[] };
  export type ReaderSelection = { bookId: string; segmentSeq: number; text: string; prefix: string; anchor: Anchor };
  export type Action = 'translate' | 'define' | 'explain' | 'simplify' | 'ask';
  export type MenuItem = Action | 'vocab';
  export type ContextScope = 'page' | 'book';
  export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
  export type Theme = 'light' | 'dark' | 'sepia';
  ```
  plus the constants from Global Constraints.
- `testControls(req: Request): { now: Date; failAfter: number | null }` — returns real `new Date()` and `null` unless `process.env.AI_MOCK === '1'`.
- `tests/helpers/server.ts` — Vitest `globalSetup` that checks the local Supabase is up (`supabase status`), starts `next dev -p 3100` with `AI_MOCK=1` and waits for `/api/health`.
- `tests/helpers/api-client.ts` — `apiClient(): { get, post, put, patch, del, login(email, password), streamText(path, body): Promise<string> }` over `fetch` to `http://localhost:3100`, keeping cookies across calls. (`login` uses Task 2's endpoint; until then it's unused.)
- Scripts: `npm run dev`, `npm run typecheck`, `npm run test:api`, `npm run e2e`, `npm run db:types` (`supabase gen types typescript --local > src/lib/supabase/database.types.ts`).

- [ ] **Step 1:** `npx create-next-app@16 . --ts --tailwind --app --src-dir --eslint --use-npm --import-alias "@/*"` in the repo root, keeping `AGENTS.md`, `README.md`, `docs/`. Add dev deps `vitest`, `@playwright/test`, `supabase`, `tsx`; run `npx supabase init`, `npx supabase start`, `npx playwright install chromium`.
- [ ] **Step 2: Write the failing test** `tests/api/health.test.ts`: `GET /api/health` → 200, body `{ ok: true }`.
- [ ] **Step 3:** `npm run test:api`. Expected: FAIL (404).
- [ ] **Step 4:** Implement the health route, `types.ts`, `test-controls.server.ts`, harness helpers, Playwright config (`webServer` = same dev command on port 3100), `.env.example` (all env vars from Global Constraints plus `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_MOCK`). CI: `npm ci`, `npm run typecheck`, `supabase start`, `npm run test:api`, `npm run e2e`.
- [ ] **Step 5:** `npm run test:api && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `chore: scaffold app with API and browser test harnesses`.

---

### Task 2: Schema and private access

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `src/lib/supabase/database.types.ts` (generated), `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/auth/require-user.ts`, `src/proxy.ts` (Next 16's renamed middleware), `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/login/page.tsx`, `tests/helpers/users.ts`, `tests/api/access.test.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/access.spec.ts`

**Interfaces:**
- Tables exactly as spec §5 "Data model" (including `usage_events`). Every table has `owner_id uuid not null default auth.uid()`, RLS enabled with `using (owner_id = auth.uid()) with check (owner_id = auth.uid())`. Check constraints on every enum-like column (format, kind, color, action, context_scope, role, status, theme). Book delete cascades to segments, reading_positions, highlights → threads → messages; `vocab_entries.book_id` is `on delete set null`. Private Storage bucket `books`, policy: object path starts with `auth.uid()::text || '/'`.
- `POST /api/auth/login` `{ email, password }` → 200 and session cookies for the allowed email; 403 `{ message: "This app is private" }` (and no session) for any other email; 401 for bad credentials. `POST /api/auth/login` `{ email, magicLink: true }` sends a magic link to the allowed email only. `POST /api/auth/logout` clears the session.
- `requireUser(): Promise<{ supabase: SupabaseClient<Database>; userId: string }>` — used by every API route; throws a 401 response without a session, 403 when the session's email is not `ALLOWED_EMAIL` (compared trimmed, case-insensitive; an empty `ALLOWED_EMAIL` allows nobody).
- Proxy redirects page requests without an allowed session to `/login`.
- `tests/helpers/users.ts`: `ensureUser(email, password)` via the service-role client. Test users: the allowed `owner@test.local` and `intruder@test.local`.
- `tests/e2e/global-setup.ts` logs in the owner and saves `tests/e2e/.auth/owner.json` storage state for later specs.

- [ ] **Step 1: Write the failing tests.** API: `GET /api/health` without a session still 200; login as owner → 200; login as ` OWNER@test.local ` → 200; login as intruder → 403 with `This app is private`; after the intruder's attempt, a request to any authenticated route (use `GET /api/me` → `{ email }`, added here) → 401; logout → `/api/me` 401. Browser: visiting `/` without a session lands on `/login`; logging in through the form lands on `/library` (an empty placeholder page for now).
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Write the migration, `npx supabase db reset`, `npm run db:types`; implement auth with `@supabase/ssr` cookies.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat: schema with row-level security and private login`.

---

### Task 3: Library and upload

**Files:**
- Create: `src/app/api/books/route.ts` (POST, GET), `src/app/api/books/[bookId]/route.ts` (GET, DELETE), `src/lib/books/validate-upload.ts`, `src/lib/books/metadata.ts`, `src/app/library/page.tsx`, `src/app/library/upload-dropzone.tsx`, `tests/fixtures/make-fixtures.ts`, `tests/fixtures/sample.pdf`, `tests/fixtures/sample.epub`, `tests/api/books.test.ts`, `tests/e2e/library.spec.ts`

**Interfaces:**
- `POST /api/books` `{ title: string; author: string | null; format: BookFormat; sizeBytes: number }` → 201 `{ bookId, signedUploadUrl, token }` for path `${userId}/${bookId}.${format}`. Server re-checks `sizeBytes` (1…`MAX_UPLOAD_BYTES`) and `format` → 400 otherwise.
- `GET /api/books` → `{ books: { id, title, author, format, extracted: boolean, lastOpenedAt: string | null }[] }`, ordered `last_opened_at desc nulls last, created_at desc`.
- `GET /api/books/[bookId]` → the same item plus `segmentCount` and `fileUrl` (1-hour signed Storage URL); 404 for another user's or unknown book.
- `DELETE /api/books/[bookId]` → 204; removes the Storage object and row (cascades per schema).
- Browser-side, before any request: `validateUpload(file: { name: string; size: number }): { ok: true; format: BookFormat } | { ok: false; reason: string }` and `sniffFormat(head: Uint8Array): BookFormat | null` (`%PDF-` → pdf, `PK\x03\x04` → epub). Reasons, exact copy: `"Only PDF and EPUB files are supported."`, `"This file is larger than 50 MB, the current limit."`, `"This file is empty."`, `"This file doesn't look like a real PDF or EPUB."`
- `readMetadata(file: File, format: BookFormat): Promise<{ title: string; author: string | null }>` — pdf.js metadata or EPUB OPF `dc:title`/`dc:creator`; falls back to the filename without extension.
- Fixtures, generated by `npx tsx tests/fixtures/make-fixtures.ts` (dev deps `pdf-lib`, `jszip`), outputs committed:
  - `sample.pdf` — title "Sample Book", author "Test Author", 3 pages. Page 1: `"She sat on the bank. The bank was steep. She sat on the bank."`, then a paragraph whose last line ends `"ephem-"` and next line starts `"eral light."`, then `"Across the page break"` as the last line. Page 2 starts `"into page two."`, then `"Ephemeral joys fade quickly."`. Page 3: `"Final page."`.
  - `sample.epub` — chapters "One" and "Two". Chapter One: 12 paragraphs of exactly 60 words, each starting with its marker `P1`…`P12`. Chapter Two: one paragraph `"Second chapter text."`.

- [ ] **Step 1: Write the failing tests.** API: POST then GET lists the book with `extracted: false`; POST with `sizeBytes: MAX_UPLOAD_BYTES + 1` → 400; with `sizeBytes: MAX_UPLOAD_BYTES` → 201; with `format: 'mobi'` → 400; isolation: a book owned by `intruder@test.local` (inserted with the service-role client) → `GET /api/books/<thatId>` is 404 and it is absent from the list; DELETE → 204 then GET → 404. Browser: upload `sample.pdf` → library shows "Sample Book" by "Test Author"; choosing `huge.pdf` (a 51 MB file generated in the test's temp dir) shows the 50 MB message and **no request** goes to `/api/books` or Storage (`page.on('request')`); choosing `fake.pdf` (text content) shows the "doesn't look like a real PDF or EPUB" message; `a.mobi` shows the unsupported message; delete removes the row.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement. The dropzone accepts drag-and-drop and a file input; after `POST /api/books` the browser uploads to the signed URL.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(library): validated direct-to-storage upload and library`.

---

### Task 4: Text extraction into segments

**Files:**
- Create: `src/app/api/books/[bookId]/segments/route.ts`, `src/lib/extract/pdf.ts`, `src/lib/extract/epub.ts`, `src/lib/extract/paragraphs.ts`, `src/lib/books/extract-and-save.ts`, `tests/api/segments.test.ts`, `tests/e2e/extraction.spec.ts`

**Interfaces:**
- `POST /api/books/[bookId]/segments` `{ segments: Segment[]; done: boolean }` (Zod) → 204. Upserts on `(book_id, seq)`; more than 50 segments → 400; `done: true` sets `segment_count = max(seq)+1` and `extracted_at`.
- `GET /api/books/[bookId]/segments?seq=<n>` → `Segment` (also used by the readers for prefix fallback and by tests); 404 if absent.
- Browser: `extractPdfSegments(data: ArrayBuffer): Promise<Segment[]>` (one per page, `label "Page N"`; a new paragraph when the vertical gap between lines exceeds 1.5× line height; a line ending in `-` joins the next line with no space; whitespace collapsed; empties dropped). `extractEpubSegments(file: File): Promise<Segment[]>` (one per spine item; label from the TOC, else `"Section N"`; one paragraph per block element without block children; empties dropped). `extractAndSave(bookId, file, format): Promise<void>` — batches of 50, each retried up to 3 times (1 s, 2 s, 4 s), final batch `done: true`. Library shows "Preparing text…" while `extracted` is false.

- [ ] **Step 1: Write the failing tests.** API: posting 2 segments with `done: true` → `GET /api/books/[id]` has `extracted: true`, `segmentCount: 2`; re-posting seq 0 replaces it (GET `?seq=0` shows the new paragraphs); 51 segments → 400; another user's book → 404. Browser: upload `sample.pdf` → "Preparing text…" then disappears; `GET ?seq=0` paragraphs include `"She sat on the bank. The bank was steep. She sat on the bank."` and a paragraph containing `"ephemeral light."` (hyphen joined); `?seq=1` includes `"Ephemeral joys fade quickly."`. Upload `sample.epub` → `?seq=0` has 12 paragraphs starting `P1`…`P12` and `label "One"`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(extract): PDF and EPUB text extraction into segments`.

---

### Task 5: PDF reader with position sync

**Files:**
- Create: `src/app/read/[bookId]/page.tsx`, `src/components/reader/PdfReader.tsx`, `src/components/reader/ReaderToolbar.tsx`, `src/lib/reader/position-saver.ts`, `src/app/api/books/[bookId]/position/route.ts`, `tests/api/position.test.ts`, `tests/e2e/pdf-reader.spec.ts`

**Interfaces:**
- `PUT /api/books/[bookId]/position` body `ReadingLocation` → 204, also sets `last_opened_at`. `GET` → `{ location: ReadingLocation | null }`.
- `createPositionSaver(save: (loc: ReadingLocation) => Promise<void>, intervalMs = 2000): { update(loc): void; flush(): Promise<void> }` — saves at most once per interval, always the latest location; `flush` runs on `visibilitychange` → hidden.
- `PdfReader` props `{ bookId; fileUrl; initialPage: number; onSelection(sel: ReaderSelection | null): void; highlights: HighlightView[] }` (`HighlightView` from Task 11; pass `[]` until then). `react-pdf` with the text layer on; each page element carries `data-page-number`. Toolbar: prev/next, page input, zoom in/out, fit-to-width.
- The read page loads `GET /api/books/[id]` and the position, then renders `PdfReader` or `EpubReader` (Task 6) by format.

- [ ] **Step 1: Write the failing tests.** API: PUT `{page: 2}` then GET → `{ location: { page: 2 } }`; after PUT on book A, `GET /api/books` lists A first; PUT on another user's book → 404; body `{page: 'x'}` → 400. Browser: open `sample.pdf`, go to page 2, wait 2.5 s, reload → page 2 shown; switching tabs (hidden) saves immediately (reload right after shows page 3 when navigated to 3 then hidden); on `phone`, `document.documentElement.scrollWidth <= 375`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement; configure the pdf.js worker per react-pdf 11's docs.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reader): PDF reader with synced position`.

---

### Task 6: EPUB reader with position sync

**Files:**
- Create: `src/components/reader/EpubReader.tsx`, `tests/e2e/epub-reader.spec.ts`
- Modify: `src/components/reader/ReaderToolbar.tsx` (font size for EPUB)

**Interfaces:**
- `EpubReader` props `{ bookId; fileUrl; initialCfi: string | null; onSelection(sel: ReaderSelection | null): void; highlights: HighlightView[] }`. foliate-js `<foliate-view>`, paginated, loaded with `next/dynamic` and `ssr: false`; reports `{ cfi }` to the position saver on relocate.
- Font sizes 14/16/18/20/24 px, per device in `localStorage` key `hmr.fontSize` (read/write in try/catch, default 18).

- [ ] **Step 1: Write the failing test.** Browser: open `sample.epub`, page forward twice, wait 2.5 s, reload → the paragraph marker visible before reload is visible after; choose 24 px → a paragraph's computed font size is `24px`, and still `24px` after reload.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reader): EPUB reader with synced position`.

---

### Task 7: Selection capture and menu

**Files:**
- Create: `src/lib/selection/capture-pdf.ts`, `src/lib/selection/capture-epub.ts`, `src/lib/selection/menu.ts`, `src/components/reader/SelectionMenu.tsx`, `tests/e2e/selection.spec.ts`
- Modify: `PdfReader.tsx`, `EpubReader.tsx`, `src/app/read/[bookId]/page.tsx`

**Interfaces:**
- `capturePdfSelection(range: Range, bookId: string): ReaderSelection | null` — segment = the page containing `range.startContainer` (`data-page-number` − 1); rects = the range's client rects on that page only, normalised to the page element; prefix = last `PREFIX_CHARS` of that page's text-layer text before the start; `null` for blank text.
- `captureEpubSelection(range: Range, bookId: string, sectionIndex: number, cfi: string): ReaderSelection | null`.
- `orderMenu(text: string): MenuItem[]` — single word (no whitespace after trim) → `['define','translate','explain','simplify','ask','vocab']`, else `['explain','translate','define','simplify','ask','vocab']`. `countWords(text: string): number`.
- `SelectionMenu` props `{ selection: ReaderSelection; onPick(item: MenuItem): void; onColor(color: HighlightColor): void }` — a row of 4 colour dots above the six buttons (wired in Task 11); over `MAX_SELECTION_WORDS` it shows only `"Select a shorter passage"`; above the selection on desktop, docked to the bottom on phone. The read page keeps the current selection in state for Tasks 10–12. Expose it for tests as `window.__hmrSelection` only when `NEXT_PUBLIC_E2E === '1'`.

- [ ] **Step 1: Write the failing test.** Browser (`sample.pdf`): double-click "steep" → first menu button "Define", 6 buttons, last "+Vocab"; select "The bank was steep." → first button "Explain"; select from "Across" on page 1 to "two." on page 2 → menu opens and `__hmrSelection` has `segmentSeq 0`, `anchor.page 1`, every rect's `y + h ≤ 1`; select the second "She sat on the bank." → `__hmrSelection.prefix` ends with `"The bank was steep. "`. EPUB: select a word in `P6` → menu opens with `segmentSeq 0`, `anchor.format 'epub'`. The fixtures are too short for a 2,001-word selection, so `SelectionMenu` is also rendered on a test route `/__test/menu?words=2001` (only when `NEXT_PUBLIC_E2E === '1'`), which shows "Select a shorter passage". Phone: the menu is docked at the bottom.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reader): selection capture and action menu`.

---

### Task 8: Threads I — create a thread and get the first answer

**Files:**
- Create: `src/lib/ai/models.ts`, `src/lib/ai/registry.server.ts`, `src/lib/ai/prompts.ts`, `src/lib/context/build.ts`, `src/lib/threads/service.server.ts`, `src/app/api/threads/route.ts`, `src/app/api/threads/[threadId]/route.ts`, `src/app/api/threads/[threadId]/chat/route.ts`, `src/app/api/test/last-prompt/route.ts`, `src/app/api/models/route.ts`, `tests/api/threads-first-answer.test.ts`

**Interfaces:**
- `type Provider = 'google' | 'anthropic' | 'openai' | 'openrouter'`; `type ModelInfo = { id; provider: Provider; label; inputUsdPerMTok: number; outputUsdPerMTok: number; tested: boolean }`. `MODELS: ModelInfo[]` with at least a Gemini Flash and a Gemini Pro, `claude-haiku-5-5`, `claude-sonnet-5-5`, one small and one large OpenAI model, and three OpenRouter models (Llama, Mistral, DeepSeek). Ids and prices copied from provider pricing pages on implementation day; `tested: true` only on the Gemini Flash and both Claude models (Task 14 revisits). Unique ids.
- `availableModels(env): ModelInfo[]` — provider env var is non-empty. `DEFAULT_ACTION_MODELS`: translate/define → the Gemini Flash id; explain/simplify/ask → `claude-sonnet-5-5`. `resolveModel(action, settingsModels, available): ModelInfo` — setting if available, else default if available, else `available[0]`; none → 503 `{ message: "No AI provider is configured." }`.
- `getLanguageModel(modelId, controls): LanguageModel` — AI SDK provider registry; with `AI_MOCK=1` a mock model streaming `"MOCK ANSWER"` in 3 chunks (`"MOCK "`, `"ANS"`, `"WER"`), usage `{ inputTokens: 100, outputTokens: 50 }`, erroring after `controls.failAfter` chunks when set, and recording its prompt (system + messages, joined as text) for `GET /api/test/last-prompt` → `{ prompt: string | null }`. Under `AI_MOCK=1` every provider counts as available.
- `GET /api/models` → `{ models: (ModelInfo & { available: boolean })[] }`.
- Context: `buildContext({ format, scope, segments, segmentSeq, text, prefix }): string` — as spec §4.6. Locating: all whitespace-normalised occurrences of `text` in the segment's paragraphs; with several, the one whose preceding text shares the longest suffix with `prefix`; ties → first. EPUB window: located paragraph, then alternately next, previous, next… until ≥ `EPUB_CONTEXT_WORDS` words or both edges; output in book order; not located → first paragraphs up to 400 words. The first user message marks the chosen occurrence inside the context with `⟦` `⟧`.
- Prompts: `buildSystemPrompt(action, language)` — shared preamble ("You help a reader understand a book. Answer in {language}. Be brief; the reader can ask follow-ups.") plus the action instruction from spec §4.5; Define requires the layout `**{term}** ({part of speech}) /{IPA}/`, meaning in context, `Example: …`. `buildFirstUserMessage({ action, selection, context, meta: { title, author, segmentLabel }, question? })` — `Book: {title}{ by author}` / `Location: {label}` / `Context:` fenced / `Selected text:` fenced / for ask `Question: {question}`. Explanation language comes from settings (Task 13); until then `'English'`.
- `POST /api/threads` `{ bookId, action, selection: ReaderSelection, scope: ContextScope }` → 201 `{ threadId, highlightId }`; creates a `thread` highlight (colour yellow) and the thread. 400 for `scope 'book'` unless `action 'ask'`, or selection over `MAX_SELECTION_WORDS`; 409 `{ message: "This book's text is still being prepared." }` when not extracted; 404 for another user's book.
- `POST /api/threads/[threadId]/chat` `{ text?: string; modelId?: string; reask?: boolean }` → AI SDK UI message stream. First turn: `{}` for translate/define/explain/simplify, `{ text: question }` for ask. The server rebuilds the whole prompt from stored data each turn (never trusts client history) and saves the assistant message on finish with `model_id`, tokens and `status 'complete'`.
- `GET /api/threads/[threadId]` → `{ thread: { id, action, scope, highlightId }, messages: { id, role, content, modelId, status, costUsd }[] }`.

- [ ] **Step 1: Write the failing tests** (arrange: create a book via the API and post the fixture segments as JSON — the same paragraphs as `sample.pdf` / `sample.epub` — with `done: true`):
  - define on "steep" (PDF seg 0) → stream text `MOCK ANSWER`; `GET /api/threads/[id]` has one assistant message, `status 'complete'`, model = the Gemini Flash id.
  - last prompt for that call contains `Book: Sample Book by Test Author`, `Location: Page 1`, the whole page-1 text, `IPA`, `Answer in English`.
  - duplicate: explain on "She sat on the bank." with prefix ending `"The bank was steep. "` → last prompt contains `The bank was steep. ⟦She sat on the bank.⟧`; with empty prefix → `⟦She sat on the bank.⟧ The bank was steep.`
  - EPUB window: explain on a word in `P6` → last prompt contains `P3`…`P9` in ascending order and not `P2` or `P10`; in `P1` → `P1`…`P7`, not `P8`.
  - ask with `scope 'book'` and `{ text: 'Who?' }` → last prompt contains `## One`, `## Two` and ends with `Question: Who?`.
  - `scope 'book'` with define → 400; 2,001-word selection → 400; book not extracted → 409 with the message; another user's book → 404.
  - every model in `GET /api/models` has a unique id and non-negative prices.
- [ ] **Step 2:** `npm run test:api -- threads-first-answer`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(threads): create threads and stream first answers with page context`.

---

### Task 9: Threads II — follow-ups, re-ask, cost, spend cap and failures

**Files:**
- Create: `src/lib/ai/cost.ts`, `src/lib/ai/spend.server.ts`, `tests/api/threads-followups.test.ts`, `tests/api/spend.test.ts`
- Modify: `src/lib/threads/service.server.ts`, `src/app/api/threads/[threadId]/chat/route.ts`

**Interfaces:**
- Cost = OpenRouter's reported cost when present, else `(inputTokens × inputPrice + outputTokens × outputPrice) / 1e6`. Stored on each assistant message.
- Month spend = sum of `messages.cost_usd` + `usage_events.cost_usd` since the start of the UTC month of `controls.now`.
- Before streaming: estimate = `Math.ceil(promptChars / 4)` × input price / 1e6. Refused when `monthSpend + estimate > cap` → 402 `{ message }` with exact copy `` `You've reached this month's AI limit of $${cap.toFixed(2)}. Raise it in Settings.` `` and nothing saved. Cap comes from settings (Task 13); until then `DEFAULT_MONTHLY_CAP_USD`.
- `{ text }` on an existing thread saves the user message first, then the answer; the prompt contains all earlier turns in order.
- `{ reask: true, modelId }` adds an assistant message to the latest user turn with that model; no user message.
- Unknown or unavailable `modelId` → 400.
- Stream error → assistant message saved with the text so far, `status 'failed'`, and only the usage reported (0 if none).
- `GET /api/spend` → `{ monthSpendUsd: number; capUsd: number }` (honours `x-test-now`).

- [ ] **Step 1: Write the failing tests.**
  - follow-up `{ text: 'More?' }` → messages: assistant, user `More?`, assistant; last prompt contains the first `MOCK ANSWER` before `More?`.
  - re-ask with `claude-haiku-5-5` → 4 messages (assistant, user `More?`, assistant, assistant); the last assistant's `modelId` is haiku; still exactly 1 user message.
  - `modelId: 'nope'` → 400.
  - cost: with the mock usage 100/50, the saved `costUsd` equals `(100 × in + 50 × out) / 1e6` for the resolved model's prices from `GET /api/models`.
  - `x-test-fail-after: 1` → stream ends with an error; thread shows an assistant message `content 'MOCK '`, `status 'failed'`; `GET /api/threads/[id]` still 200.
  - spend (service-role arrange: insert `usage_events` rows): one row 0.5 this month, one row 0.25 this month, one row 3 last month → `GET /api/spend` → `0.75`.
  - month rollover: a row at `2026-10-31T23:30:00Z`; with `x-test-now: 2026-11-01T00:30:00+07:00` (still Oct in UTC) spend includes it; with `x-test-now: 2026-11-01T00:00:00Z` it doesn't.
  - cap: seed spend `10` (cap 10) → define → 402, message contains `$10.00` and `Settings`, no new assistant row. Boundary: run one define, compute its estimate `E = ceil(len(last prompt) / 4) × inputPrice / 1e6`; then on an identical new thread, seed spend so the total is `10 − E` → allowed; seed `10 − E + 0.000001` → 402.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(threads): follow-ups, re-ask, cost accounting, spend cap and failure handling`.

---

### Task 10: Thread panel

**Files:**
- Create: `src/components/thread/ThreadPanel.tsx`, `src/components/thread/ModelSwitcher.tsx`, `src/components/thread/MessageView.tsx`, `tests/e2e/thread.spec.ts`
- Modify: `src/app/read/[bookId]/page.tsx`

**Interfaces:**
- `ThreadPanel` props `{ threadId: string | null; action: Action; selection: ReaderSelection | null; onClose(): void }`. Creates the thread on open (for ask: on first submit, with the `Use whole book` toggle deciding scope), then uses `@ai-sdk/react`'s chat hook against the chat route, customising the request body to `{ text, modelId, reask }`. Reopening loads `GET /api/threads/[id]`.
- Desktop: right panel, 420 px. Phone (< 768 px): bottom sheet, 70% height.
- Each answer shows its model label. Switcher lists `GET /api/models` entries with `available: true`, with a `not tested` badge where `tested` is false. Re-ask button. Failed answers show `Retry` (sends `{ reask: true }`). A 402 shows the message with a link to `/settings`. Markdown via `react-markdown` with raw HTML disabled.

- [ ] **Step 1: Write the failing test.** Browser: select "Ephemeral" (page 2) → Define → panel shows `MOCK ANSWER`; follow-up "More?" → second answer; pick `claude-haiku-5-5` → Re-ask → third answer labelled with haiku's label; reload → open the highlight (Task 11 draws it; until then reopen via `?thread=<id>` query, which the read page supports) → three answers present; Ask… with "Use whole book" on → `GET /api/threads/[id]` reports `scope 'book'`; with route interception making chat return 402, the panel shows the cap message and a Settings link; with `x-test-fail-after: 1` injected via `page.route` header rewrite, the answer shows `Retry`, and clicking it produces a complete answer. Phone: bottom sheet, `scrollWidth <= 375`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(threads): thread panel with follow-ups, model switcher, re-ask and retry`.

---

### Task 11: Highlights and notes

**Files:**
- Create: `src/app/api/highlights/route.ts` (GET by book, POST), `src/app/api/highlights/[highlightId]/route.ts` (PATCH, DELETE), `src/components/reader/PdfHighlightLayer.tsx`, `src/components/reader/NoteEditor.tsx`, `tests/api/highlights.test.ts`, `tests/e2e/highlights.spec.ts`
- Modify: `SelectionMenu.tsx` (colour dots call `onColor`), `PdfReader.tsx`, `EpubReader.tsx`, read page

**Interfaces:**
- `type HighlightView = { id; kind: 'note' | 'thread'; color: HighlightColor; anchor: Anchor; threadId: string | null; note: string | null }` (add to `types.ts`).
- `GET /api/highlights?bookId=` → `{ highlights: HighlightView[] }`. `POST /api/highlights` `{ bookId, selection, color }` → 201 note highlight. `PATCH /api/highlights/[id]` `{ color?, note? }` → 200. `DELETE` → 204 (a thread highlight's thread and messages go with it).
- PDF: absolutely positioned boxes per page from normalised rects × the rendered page size; thread highlights get a dotted underline instead of a fill. EPUB: foliate-js overlayer — `highlight` for notes, `underline` for threads, keyed by CFI. Tapping a note → `NoteEditor` (colour, note, delete); tapping a thread highlight → its `ThreadPanel`.

- [ ] **Step 1: Write the failing tests.** API: POST green note → GET lists it with `kind 'note'`; PATCH `{ note: 'ok', color: 'pink' }` → reflected; colour `'red'` → 400; DELETE a thread highlight → `GET /api/threads/[id]` → 404; another user's highlight → 404. Browser: green note on "Final page." with note "ok", reload → green box present, editor shows "ok"; zoom in → the box still overlaps the "Final page." text span (bounding-box intersection > 80% of the span); cross-page selection from Task 7 → its thread highlight boxes are all inside page 1; EPUB note in `P6` persists after reload; tapping a thread highlight opens its panel with the saved answers.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(highlights): note and thread highlights in PDF and EPUB`.

---

### Task 12: Vocab

**Files:**
- Create: `src/app/api/vocab/route.ts` (GET, POST), `src/app/api/vocab/[entryId]/route.ts` (DELETE), `src/app/api/vocab/export/route.ts`, `src/lib/vocab/sentence.ts`, `src/lib/vocab/export.ts`, `src/app/vocab/page.tsx`, `tests/api/vocab.test.ts`, `tests/e2e/vocab.spec.ts`
- Modify: read page (handle `vocab` menu item; support `?at=<url-encoded anchor JSON>`)

**Interfaces:**
- `POST /api/vocab` `{ bookId, selection }` → 201 `{ entry }` at once with `term` (trimmed selection), `sentence` (the sentence around the located occurrence, split on `.`/`!`/`?` + whitespace, keeping the terminator), `anchor`, `bookId`, and `meaning`: the first answer of an existing Define thread with the same `segment_seq` and quote, else `null`. When `null`, a background job (Next `after()`) calls `generateText` with the Define model and a one-line prompt (≤ 25 words, in the explanation language), subject to the spend cap, storing cost in `usage_events`; if refused, `meaning` stays `null`.
- `GET /api/vocab?q=` → entries newest first, `q` matching term or meaning case-insensitively; each has `bookTitle` or `null`.
- `DELETE /api/vocab/[id]` → 204.
- `GET /api/vocab/export?format=csv` → `vocab.csv`, header `term,meaning,sentence,book,created_at`, RFC 4180 quoting. `format=anki` → `vocab-anki.txt`, no header, one line per entry: `term\tmeaning<br><i>sentence</i><br>— book`, with tabs/newlines inside fields replaced by spaces.
- Vocab page: search box, rows with Jump (opens `/read/[bookId]?at=…`; disabled when the book is gone) and Delete; `meaning` null shows "No meaning yet". Toast after +Vocab: "Saved to vocab".

- [ ] **Step 1: Write the failing tests.** API: vocab on "steep" → `sentence 'The bank was steep.'`; poll `GET /api/vocab` until `meaning === 'MOCK ANSWER'` (≤ 5 s) and `GET /api/spend` increased; duplicate text: vocab on "bank" with a prefix ending `"She sat on the bank. The "` → `sentence 'The bank was steep.'`; with a prefix ending `"The bank was steep. She sat on the "` → `sentence 'She sat on the bank.'`; after a Define thread on "steep", vocab on "steep" → `meaning` is that answer immediately and no new `usage_events` row; `q=zzz` → empty; export CSV after setting one entry's meaning to `a, "b"` with the service-role client → parsing the CSV gives back `a, "b"`; Anki export has exactly one tab per line; spend at cap → entry saved, meaning stays `null`; delete the book → entry remains with `bookTitle: null`.
- [ ] **Step 2:** Browser: select "steep" → +Vocab → toast "Saved to vocab"; vocab page lists it; Jump opens the book on page 1; search "zzz" hides it; delete removes it; export CSV downloads a file whose second line starts with `steep,`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run both. Expected: PASS.
- [ ] **Step 6: Commit** `feat(vocab): save words with meanings, vocab page and exports`.

---

### Task 13: Settings and themes

**Files:**
- Create: `src/app/api/settings/route.ts` (GET, PUT), `src/lib/settings/settings.server.ts`, `src/app/settings/page.tsx`, `src/components/ThemeProvider.tsx`, `tests/api/settings.test.ts`, `tests/e2e/settings.spec.ts`
- Modify: `src/app/layout.tsx`, `src/app/globals.css` (light/dark/sepia tokens), chat route and vocab job (read language, models, cap from settings)

**Interfaces:**
- `type Settings = { explanationLanguage: string; actionModels: Partial<Record<Action, string>>; monthlyCapUsd: number; theme: Theme }`. `GET /api/settings` → `{ settings, monthSpendUsd }`, creating defaults (`'English'`, `{}`, `10`, `'light'`) on first read. `PUT /api/settings` (Zod): language 1–40 chars; cap `0 ≤ cap ≤ 1000`; model ids must be available; theme one of three → 200 or 400.
- Page: language text field with suggestions (English, Indonesian, Spanish, French, German, Japanese, Chinese, Arabic); one model select per action (available models only, `not tested` badges); cap; `$X.XX of $Y.YY this month`; theme picker.
- Theme is a class on `<html>` set server-side from settings (no flash). Dark theme inverts the PDF canvas (`filter: invert(1) hue-rotate(180deg)`); sepia warms the background and leaves the canvas.

- [ ] **Step 1: Write the failing tests.** API: first GET returns the defaults; PUT cap `-1`, `1001`, theme `'blue'`, model `'nope'` → 400 each; PUT language `Indonesian` → the next define's last prompt contains `Answer in Indonesian`; PUT `actionModels: { define: 'claude-haiku-5-5' }` → next define's answer has haiku's `modelId`; PUT cap `0` → define → 402 with `$0.00`. Browser: settings shows `$0.00 of $10.00 this month` on a fresh user; choose dark → after reload `<html>` has class `dark` and the PDF canvas has the invert filter; phone `scrollWidth <= 375` on the settings page.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): language, per-action models, spend cap and themes`.

---

### Task 14: Deploy and real-model check

**Files:**
- Create: `docs/deploy.md`, `scripts/smoke-models.ts`
- Modify: `README.md` (what the app is, local dev, link to deploy guide), `src/lib/ai/models.ts` (`tested` flags)

**Interfaces:**
- `npx tsx scripts/smoke-models.ts` — for every model whose key is set, runs Define on "bank" in "She sat on the bank of the river." and Explain on a 3-sentence passage through the real provider; prints model id, latency, cost and answer, then the total cost.

- [ ] **Step 1:** Write `docs/deploy.md`: create the Supabase project; `supabase link` + `supabase db push`; disable sign-ups and create the one user; create the Vercel project from the GitHub repo; set env vars (from `.env.example`, without `AI_MOCK`); set Supabase Auth site and redirect URLs to the Vercel domain.
- [ ] **Step 2:** Deploy by following it. Expected: the production URL redirects to `/login`; the owner logs in; `GET /api/test/last-prompt` → 404.
- [ ] **Step 3:** Run the smoke script with real keys. Expected: every model answers. Set `tested: true` on models whose Define follows `**term** (pos) /IPA/` and gives the in-context meaning (river bank); `false` otherwise.
- [ ] **Step 4:** Manual check on phone and laptop: upload a real PDF and EPUB; Define, Explain, follow-up, Re-ask with another provider; +Vocab; reopen a thread on the other device; position resumes there; spend in Settings increased.
- [ ] **Step 5: Commit** `docs: deploy guide and tested model flags`.
