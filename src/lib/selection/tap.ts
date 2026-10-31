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
