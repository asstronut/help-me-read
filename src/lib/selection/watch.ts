const SETTLE_MS = 150;

/**
 * Calls `onSettle` with the document's selected range (or null once it is cleared) after the
 * user stops changing it: never mid-drag, and only once a burst of changes has settled.
 */
export function watchSelection(doc: Document, onSettle: (range: Range | null) => void): () => void {
  let pointerDown = false;
  let changedWhileDown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const selection = doc.getSelection();
      onSettle(selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null);
    }, SETTLE_MS);
  };
  const onChange = () => {
    if (pointerDown) changedWhileDown = true;
    else settle();
  };
  const onDown = () => {
    pointerDown = true;
  };
  const onUp = () => {
    pointerDown = false;
    if (changedWhileDown) settle();
    changedWhileDown = false;
  };

  doc.addEventListener('selectionchange', onChange);
  doc.addEventListener('pointerdown', onDown);
  doc.addEventListener('pointerup', onUp);
  doc.addEventListener('pointercancel', onUp);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('selectionchange', onChange);
    doc.removeEventListener('pointerdown', onDown);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onUp);
  };
}
