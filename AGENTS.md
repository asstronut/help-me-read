# AGENTS.md

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## UI rules

The visual design lives on the "Help Me Read — UI Makeover" canvas (a claude.ai artifact), including its Style reference board. `docs/plans/ui-makeover.md` turns it into build phases. Any new or restyled UI follows these rules:

- **Keep accessible names stable.** The e2e tests find controls by role and name (`Next page`, `Zoom in`, `Save to vocab`, …). Restyle freely, but when a name or visible text must change, update the test in the same PR and say so in the PR description.
- **Use the theme tokens, not raw colours.** Every colour comes from the tokens in `src/app/globals.css` (`bg`, `surface`, `panel`, `chip`, `ink`, `muted`, `rule`, `accent`, `danger`), defined for `.light`, `.sepia` and `.dark`.
- **44px touch targets** for every button and link. The one exception is a `MenuItem` row, which is 36px when a mouse is the pointer and 44px on touch.
- **Two button sizes.** `Button` is `regular` for an action that stands on the page (Continue, Save changes). Inside a popover, dialog or small card, use `size="compact"`: a 36px filled shape inside the same 44px target, with `secondary` for Cancel, `primary` for Save and `danger` for a confirmed delete.
- **Check all three themes** (Light, Sepia, Dark) before merging.
- **Desktop first, tablet second.** There are no phone designs, but the e2e suite has a phone project, so every change must still work at phone width (stacked, not designed).
- **Build from the shared primitives** in `src/components/ui/`: `Button` (primary / secondary / quiet / danger, regular or compact), `IconButton` (44px, `aria-label` required), `Popover` (a card hanging from its anchor), `MenuItem`, `SegmentedControl`, `InlineAlert` (errors, with an action), `Toast` (status pill), and the icons in `icons.tsx`. Add a primitive there rather than one-off styling.
- **Fonts:** Literata for reading text and serif titles, Geist for the interface.
- **Highlight colours** come only from `src/components/reader/highlight-colors.ts`.

## Storyboard before code

A new interaction, or a change to how an existing one behaves, needs a storyboard on the canvas, approved by the human, before any code. A restyle that keeps the behaviour does not.

- **Steps × devices.** One row per step of each flow (how the reader gets in, each action, how they get out), one column per device: desktop (mouse), tablet landscape, tablet portrait, phone. PDF gets the full grid; EPUB gets the rows where it behaves differently (placement, two-page spread, near an edge).
- **Check every row against these seven**, adding frames where one changes what the reader sees:
  1. **Theme**: Light, Sepia, Dark; at least one Dark frame per flow.
  2. **Input**: mouse, touch, keyboard only (focus order, Esc, where focus goes after), screen reader names.
  3. **States**: empty, saving, error, offline, very long content.
  4. **Position and layout**: next to a screen edge, a zoomed PDF, a two-page spread, a side panel open.
  5. **Leaving the flow**: a page turn, a new selection, another panel opening while it is open. Say what happens to unsaved input.
  6. **First time vs heavy use**: no data yet vs many overlapping items.
  7. **Tests**: each frame names the e2e test that covers it, or says "manual check".
- **Wait for approval.** Open questions stay marked on the frame until the human answers them. Build only what the approved frames show.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
