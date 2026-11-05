# UI makeover: build order

The design lives on the "Help Me Read — UI Makeover" canvas (claude.ai artifact). This plan turns it into a sequence of phases. **Each phase is one pull request**, with one commit per step, so each step can still be reviewed on its own. Each PR is shippable on its own and leaves `npm run typecheck`, `npm run test:api` and `npm run e2e` green. (One PR per phase rather than per step keeps CI runs down: every PR push and every merge to `master` runs the full suite, about 10 minutes.)

**Scope:** desktop first, tablet second. There are no phone designs, but the e2e suite has a phone project, so every change must still work at phone width (stacked, not designed).

## Rules for every PR

- **Keep accessible names stable.** The e2e tests find controls by role and name (`Next page`, `Zoom in`, `Fit to width`, `Page number`, `Selection menu`, `Highlight yellow`, `+Vocab`, `Retry`, `Delete thread`, `Yes, delete`, `Follow-up`, `Save`, …). Restyle freely, but when a name or visible text must change, update the test in the same PR and say so in the description.
- **Use the tokens, not raw colours.** Every colour comes from the theme tokens added in step 1.
- **44px touch targets** for every button and link.
- **Check all three themes** (Light, Sepia, Dark) before merging.

## Phase 1: Foundations (no layout changes)

1. **Theme tokens** in `src/app/globals.css`: replace the two variables per theme with the full set from the Style reference board: `bg`, `surface`, `panel`, `chip`, `ink`, `muted`, `rule`, `accent`, `danger` (+ tint), for `.light`, `.sepia`, `.dark`. Expose them through `@theme inline` so Tailwind classes can use them.
2. **Fonts.** Remove `font-family: Arial` from `body` (it currently hides the Geist font that `layout.tsx` already loads). Add Literata through `next/font/google` for reading text and serif titles.
3. **One highlight palette.** Make `src/components/reader/highlight-colors.ts` the single source: yellow `#F2CC4D`, green `#8CC79A`, blue `#8DB8DE`, pink `#E7A3BF`; tints are the same colour with transparency. `SelectionMenu` and `NoteEditor` dots use these instead of Tailwind `bg-*-300` classes.
4. **Shared primitives** in `src/components/ui/`: `Button` (primary / secondary / quiet / danger), `IconButton` (44px, required `aria-label`), `SegmentedControl` (radio group), `InlineAlert` (calm error with an action), `Toast` (status pill), and a small inline-SVG icon set (chevron, menu ☰ with a short third line, bookmark, close, refresh, plus, more ⋯).

Expected test impact: none.

## Phase 2: Reader shell

5. **Top bar** for both formats: ‹ Library, book title · chapter, **Aa**, bookmark. Start with the title only; the chapter name comes in step 12.
6. **PDF page bar**: move ‹ page › / zoom / Fit to width out of the top row into a floating bar at the bottom. Keep the names `Previous page`, `Next page`, `Page number`, `Zoom in`, `Zoom out`, `Fit to width`.
7. **EPUB page turning**: keep `Previous page` / `Next page` (tests use them) but make them quiet, shown on hover at the page edges.
8. **Keyboard**: ← → / Page Up / Page Down / Space turn pages, but not while focus is in an input or textarea.
9. **Progress footer**: thin line plus a percentage. PDF: page ÷ page count. EPUB: the fraction foliate-js reports (check it exists before building). Leave out "min left in chapter" for now; it needs a reading-speed estimate.
10. **EPUB reading styles**: extend `readerCss()` in `EpubReader.tsx` with line height 1.7, Literata, and a max line width (about 34em).

Expected test impact: low, as long as the names above stay.

## Phase 3: Selection and the side panel

11. **Selection menu**: light surface that follows the theme, 44px buttons, palette from step 3. Decide whether the vocab button keeps its visible text `+Vocab` (no test change) or becomes a plus icon + "Vocab" (update `selection.spec.ts` and `vocab.spec.ts`).
12. **Thread panel restyle**: big serif quote, then the answer, then a rounded follow-up box; model name and context in small grey text. Keep `Follow-up`, `Send`, `Close`, `Delete thread`, `Re-ask`.
13. **Ask composer**: replace the "Use whole book" checkbox with the segmented control "Answer using: This page / Whole book", plus the line "Whole book sends more text, so it costs more." (true: `lib/context/build.ts` sends every section for `book`). Show the spending-limit error as a calm `InlineAlert` that links to Settings.
14. **Note editor and toasts**: restyle with the primitives. "Saved to vocab" becomes a status pill. An **Undo** link is optional; it needs the POST to return the new entry's id so it can call `DELETE /api/vocab/[entryId]`.

## Phase 4: Finding your way in a book

15. **Contents outline (☰)** under ‹ Library, its top lined up with the first line of text or the top of the PDF page. Two levels (e.g. Volume › Chapter), expandable, current item marked. It collapses to the ☰ icon when the side panel is open or the window is narrow. Sources: EPUB from the foliate-js table of contents; PDF from the file's bookmarks through pdf.js. When a PDF has no bookmarks, show "No contents in this PDF". (Check both libraries' APIs before starting.) The current chapter name also fills the top bar from step 5.
16. **Highlights & threads panel** (bookmark button): heading "In this book", tabs **All / Notes / Threads** with no counts, a small "N items" line, items grouped by chapter, click jumps to the highlight (the reader already supports `?at=`). API change: `/api/highlights` must also return the highlight's text (`highlights.quote` is already stored) and its chapter label (`segments.label`).

## Phase 5: Reading settings (Aa)

17. **Aa popover on desktop.** Shared: theme (Light / Sepia / Dark), saved through the existing settings API so it stays in sync with Settings. EPUB only: typeface (Literata / Sans / Atkinson Hyperlegible), size (today's `hmr.fontSize`), line spacing, line width. **Decide first:** keep these in localStorage like font size today (per device), or add columns to the settings table (synced between devices, needs a migration).
18. **PDF options**: Fit width / Whole page, and "Keep PDF colours in Dark" (makes today's invert filter optional). **Crop white margins** is a separate research task: it needs a way to detect each page's content box.

## Phase 6: Pages around the book

19. **Library**: "Continue reading" card (the book with the latest `books.last_opened_at`), shelf of typographic covers, ⋯ menu holding Delete with the existing confirmation. Failed book: cover dimmed with a **Retry** button on it, placed outside the cover link so clicking it doesn't open the book, plus the line "Couldn't prepare text". Keep the shelf as a `<ul>`/`<li>`, since the tests use `listitem`. Progress per book needs a stored percentage or page count; until then show format + "New" only.
20. **Settings**: sections Reading / AI models / Spending / Account, theme cards, a spending bar. `settings.spec.ts` matches the exact text "$x of $10.00 this month": keep that wording or update the test.
21. **Vocab and Login**: restyle with the style reference; no separate mockups.

## Phase 7: Tablet

22. **Tap zones**: left third previous page, right third next page, middle shows or hides the controls. A tap on a highlight must still open it (covered by `highlights.spec.ts`).
23. **Landscape spread**: two text columns for EPUB in landscape (check foliate-js's column settings).

## Decisions still open

| Decision | Options | Needed by |
|---|---|---|
| Vocab button text | keep `+Vocab`, or icon + "Vocab" | step 11 |
| Where reading preferences live | localStorage (per device) or settings table (synced) | step 17 |
| Undo after "Saved to vocab" | build now or later | step 14 |
| Reading progress in the Library | store a percentage, or skip | step 19 |
| Crop white margins | research first | after step 18 |
