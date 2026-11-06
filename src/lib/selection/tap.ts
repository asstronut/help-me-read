// A press that moves further than this before release is a drag (a selection being made), not a tap.
const TAP_SLOP_PX = 8;

type Point = { x: number; y: number };

/**
 * Remembers where each press in `doc` started and calls `onRelease` before any other click
 * handler sees the release, with whether it was a tap. Returns a function that stops watching.
 */
export function watchTaps(doc: Document, onRelease: (tap: boolean) => void): () => void {
  let pressedAt: Point | null = null;
  const onDown = (e: PointerEvent) => {
    pressedAt = { x: e.clientX, y: e.clientY };
  };
  const onClick = (e: MouseEvent) => {
    const from = pressedAt;
    onRelease(!!from && Math.hypot(e.clientX - from.x, e.clientY - from.y) <= TAP_SLOP_PX);
  };
  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('click', onClick, true);
  };
}

/**
 * Calls `onTap` for each finger or pen tap in `doc` that is free to act on the page: not the end
 * of a drag, not on a link, and not one that only clears a selection. A mouse click never counts:
 * with a mouse, clicking the text is for selecting it. Runs after the document's own click
 * handlers (it listens on the window), so they have had their say. Returns a function that stops
 * watching.
 */
export function watchPageTaps(doc: Document, onTap: (e: MouseEvent) => void): () => void {
  const win = doc.defaultView;
  if (!win) return () => undefined;
  let pressed: (Point & { counts: boolean }) | null = null;
  const onDown = (e: PointerEvent) => {
    const selected = !(doc.getSelection()?.isCollapsed ?? true);
    pressed = { x: e.clientX, y: e.clientY, counts: e.pointerType !== 'mouse' && !selected };
  };
  const onClick = (e: MouseEvent) => {
    const from = pressed;
    pressed = null;
    if (!from?.counts || Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_SLOP_PX) return;
    if (e.target instanceof win.Element && e.target.closest('a[href]')) return;
    onTap(e);
  };
  doc.addEventListener('pointerdown', onDown, true);
  win.addEventListener('click', onClick);
  return () => {
    doc.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('click', onClick);
  };
}
