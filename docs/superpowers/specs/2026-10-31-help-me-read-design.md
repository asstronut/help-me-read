# help-me-read — Design Spec

**Status:** agreed in a grilling session, 2026-10-31
**Canonical spec:** GitHub issue [asstronut/help-me-read#1](https://github.com/asstronut/help-me-read/issues/1). This file is a mirror for the plan; if the two disagree, the issue wins.
**Owner:** single user (the author)

## 1. Purpose

A personal web reader for PDF and EPUB books with AI built in. While reading, the user selects text and asks the AI to translate it, define a word in context, explain a passage, simplify it, or answer a free question. Each answer can be followed up, and the conversation is saved on that spot in the book. This replaces copying passages into a separate chatbot.

## 2. Users and scope

- One user. Nobody else signs up. There is no billing, no multi-tenant UI, and no public launch.
- Same library on every device: books, reading position, highlights, AI threads, vocab and settings sync through a server.
- Books are mostly in English. AI answers come back in the **explanation language**, a setting (default English).

## 3. Glossary

| Term | Meaning |
|---|---|
| **Book** | One uploaded PDF or EPUB file plus its metadata (title, author, format). |
| **Segment** | A unit of a book's extracted text: one page of a PDF, or one section (spine item) of an EPUB. Stored as an ordered list of paragraphs. |
| **Selection** | Text the user selected, plus where it is: segment number, the selected text, the 200 characters before it (**prefix**), and an **anchor** for drawing it. |
| **Anchor** | Where to draw a highlight: PDF = page number + rectangles normalised to the page (0–1); EPUB = a CFI string. |
| **Action** | One of `translate`, `define`, `explain`, `simplify`, `ask`. Each starts a thread. |
| **Menu item** | An action, or `vocab` (+Vocab). Shown in the selection menu. |
| **Thread** | A saved AI conversation about one selection: the first answer plus any follow-ups. Always belongs to a highlight. |
| **Highlight** | A marked selection in a book. Kind `note` (colour + optional typed note, no AI) or kind `thread` (has a thread). |
| **Context** | The book text sent to the AI with a selection. **Page context** by default; **book context** opt-in for Ask only. |
| **Vocab entry** | A saved word: the term, the sentence it appeared in, the book and anchor, and a short meaning. |
| **Model registry** | The list of AI models the app can call, with provider, price and a `tested` flag. A model is **available** only when its provider's API key is set. |
| **Spend cap** | A monthly USD limit on AI cost. Calls are refused once it is reached. |

## 4. Features (v1)

### 4.1 Library and upload
- Upload PDF or EPUB by drag-and-drop (desktop) or file picker (phone). No other import in v1.
- Accepted: `.pdf` and `.epub`, at most **50 MB per file** (the Supabase free-plan per-file limit). Bigger files are refused before upload with a message that says why.
- Title and author come from file metadata; the filename (without extension) is the fallback title.
- After upload, the browser extracts the book's text into segments and saves them. A book can be read before extraction finishes, but AI actions wait until it has.
- The library lists books by last opened, newest first. A book can be deleted: that removes the file, segments, highlights and threads. Its vocab entries **stay** and lose their jump link.

### 4.2 Reading
- **PDF:** the original page layout, rendered with pdf.js, with a selectable text layer. Page navigation, zoom, fit-to-width. Only digital PDFs: a page with no text layer can be read but not selected.
- **EPUB:** reflowable rendering with foliate-js. Font size control, paginated reading.
- Reading position syncs: PDF page number, EPUB CFI. Saved at most every 2 seconds while reading; opening a book resumes there on any device.
- Themes: light, dark and sepia, in all views.

### 4.3 Selection menu
Selecting text shows a menu with six items: **Translate · Define · Explain · Simplify · Ask… · +Vocab**.
- A row of 4 colour dots above the items creates a plain highlight (§4.8).
- If the selection is a single word (no whitespace after trimming), **Define** comes first. Otherwise **Explain** comes first. The rest keep the order above.
- Selections over **2,000 words** are refused with a message ("Select a shorter passage").
- A selection that crosses a page or section boundary belongs to the segment where it **starts**.

### 4.4 Threads
- Translate, Define, Explain, Simplify and Ask each create a thread highlight on the selection and open the **thread panel**: a side panel on desktop, a bottom sheet on phone.
- The answer streams in as it is generated.
- A follow-up box under the answers lets the user keep asking. Follow-ups see the whole thread so far.
- A model switcher in the panel picks the model for the next message. **Re-ask** regenerates the latest answer with the selected model; both answers stay in the thread, each labelled with its model.
- Threads are saved. Tapping a thread highlight reopens its panel.
- **Ask…** opens the panel with an empty question box and a **Use whole book** toggle (off by default).
- If a provider fails mid-answer, the partial text is kept and marked failed, a **Retry** button is shown, and only tokens the provider reports are charged.

### 4.5 Answer style
Each action has a fixed instruction. All answers are written in the explanation language and are short by default; follow-ups can ask for more.
- **Translate:** a natural translation of the selection into the explanation language. One line of notes only if a phrase has no direct equivalent.
- **Define:** the term, part of speech, IPA pronunciation, its meaning **in this context** (2–4 lines), and one short example sentence.
- **Explain:** what the passage means and why it matters in context, in one short paragraph.
- **Simplify:** the selection rewritten in plain, easy language at about the same length.
- **Ask:** answers the user's question about the selection, using the context given.

### 4.6 Context sent to the AI
Every request includes the book title, author (if known) and the current chapter/segment label, plus:
- **PDF page context:** the full text of the page the selection starts on.
- **EPUB page context:** the paragraph containing the selection, then neighbouring paragraphs added alternately after and before it until the total reaches **about 400 words**. It ends after the paragraph that crosses 400 words, and stops at the section edges. This is the same on every device.
- **Book context** (Ask with "Use whole book" on): every segment's text in order.
- The selection is found in its segment's paragraphs by matching the selected text. When the text appears more than once, the occurrence whose preceding text best matches the prefix wins.

### 4.7 Vocab
- **+Vocab** saves the term, the sentence containing it, the book and the anchor at once, and shows a toast. It does not open a panel.
- If the selection already has a Define thread, its first answer becomes the meaning. Otherwise the meaning is filled in the background by the Define model, in one short call (charged like any other).
- The vocab page has search (term and meaning), a jump to the source (opens the book at the anchor), delete, and export as **CSV** or **Anki TSV** (front = term, back = meaning + sentence + book title).
- No flashcards in v1.

### 4.8 Highlights and notes
- Plain highlights: pick one of 4 colours (yellow, green, blue, pink) and optionally type a note. No AI involved.
- Thread highlights use the same layer with a distinct underline style.
- Highlights draw on PDF pages (normalised rectangles) and in EPUB views (CFI overlay), on every device.

### 4.9 AI providers and models
- Providers: **Google (Gemini), Anthropic (Claude), OpenAI** directly, plus **OpenRouter** for everything else (Llama, Mistral, DeepSeek, Qwen…). All are called through the Vercel AI SDK.
- A provider's models appear only when its API key environment variable is set.
- The model registry is a config file: model id, provider, display label, input and output price per million tokens, and a `tested` flag. Untested models show a "not tested" badge in pickers.
- Settings set a default model for each action. Shipped defaults: Translate and Define → a Gemini Flash model; Explain, Simplify and Ask → Claude Sonnet. If a default's key is missing, the first available model is used.
- API keys live only in server environment variables. The browser never sees them; every AI call goes through the app's server.

### 4.10 Cost tracking and spend cap
- Every AI call stores its input/output tokens and cost in USD (thread messages in `messages`, other calls in `usage_events`). OpenRouter calls use the cost OpenRouter reports; other providers use the registry prices.
- Settings show this month's spend (UTC calendar month) and the cap, default **$10**.
- Before a call, the app estimates its input cost (characters ÷ 4 = tokens). If month spend + estimate is above the cap, the call is refused with a message naming the cap and a link to Settings. A call that is already running finishes.

### 4.11 Settings
Explanation language, default model per action, monthly cap, this month's spend, theme.

### 4.12 Access
- Login with Supabase Auth (email + password, or magic link), limited to one email given in an env var. Supabase sign-ups are disabled. Any other email is refused even if it somehow has an account.
- Every page except login requires a session. Database rows are protected with row-level security by owner.

## 5. Architecture

- **App:** Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel. One codebase for UI and server routes.
- **Data:** Supabase Postgres (tables below), Supabase Auth, Supabase Storage (private `books` bucket). Book files upload **directly from the browser to Storage** with a signed upload URL, because Vercel functions cap request bodies far below 50 MB.
- **AI:** Vercel AI SDK with provider packages for Google, Anthropic, OpenAI and OpenRouter, behind one model registry. Streaming responses from a route handler; the client uses the SDK's React chat hook.
- **Text extraction:** in the browser after upload (pdf.js text content for PDF, foliate-js sections for EPUB), sent to the server in batches and stored as segments. The server builds AI context from stored segments, so prompts don't depend on what the client sends besides the selection.

### Data model

| Table | Key columns |
|---|---|
| `books` | id, owner_id, title, author, format (`pdf`/`epub`), storage_path, size_bytes, segment_count, extracted_at, last_opened_at, created_at |
| `segments` | book_id, seq, label, paragraphs `text[]` — primary key (book_id, seq) |
| `reading_positions` | book_id (pk), location `jsonb` (`{page}` or `{cfi}`), updated_at |
| `highlights` | id, book_id, kind (`note`/`thread`), color, segment_seq, anchor `jsonb`, quote, prefix, note, created_at |
| `threads` | id, highlight_id, action, context_scope (`page`/`book`), created_at |
| `messages` | id, thread_id, role (`user`/`assistant`), content, model_id, status (`complete`/`failed`), input_tokens, output_tokens, cost_usd, created_at |
| `vocab_entries` | id, owner_id, book_id (nullable, `on delete set null`), term, sentence, meaning, anchor `jsonb`, created_at |
| `settings` | owner_id (pk), explanation_language, action_models `jsonb`, monthly_cap_usd, theme |
| `usage_events` | id, owner_id, model_id, input_tokens, output_tokens, cost_usd, created_at — AI calls that aren't thread messages (the +Vocab meaning fill) |

Every table carries `owner_id` (directly, or through `books`), and row-level security allows only `owner_id = auth.uid()`.

## 6. Non-functional requirements

- **Reliability first.** Typed database access (generated Supabase types), unit tests for all pure logic, and end-to-end tests for the core flow: upload → read → select → ask → thread saved → reopen.
- AI calls in tests use the AI SDK's mock model, so tests never hit a real provider or cost money.
- The phone layout works at 375 px width with no horizontal scroll.
- The first answer token should appear within the provider's normal latency, because answers stream.

## 7. Out of scope for v1

| Item | When |
|---|---|
| Offline reading of recently opened books, with sync on reconnect | v1.1 |
| Scanned PDFs (page image sent to a vision model) | later |
| Reflowed text mode for PDF | later |
| Flashcards / spaced repetition (Anki export covers it) | later |
| Google Drive or URL import | later |
| Multiple users, user-supplied API keys | later |

## 8. Known limits

- Supabase free plan: 1 GB total storage and 50 MB per file. More needs the Pro plan or moving files to Cloudflare R2.
- Model ids and prices change. The registry is updated by hand from each provider's pricing page.
- Book context sends the whole book on every Ask with the toggle on. The spend cap is the guard against this getting expensive.
