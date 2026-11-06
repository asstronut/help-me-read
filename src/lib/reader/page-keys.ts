/** Which way a key turns the page: -1 back, 1 forward. */
export type PageTurn = -1 | 1;

// Widgets that use the arrow keys themselves (a SegmentedControl is a radiogroup).
const ARROW_WIDGETS =
  '[role="radiogroup"], [role="tablist"], [role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="grid"], [role="tree"]';
// Controls that Space presses or toggles.
const SPACE_CONTROLS = 'button, summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"]';

/**
 * Elements only, checked by node type rather than `instanceof`: an EPUB chapter is drawn in an
 * iframe, whose elements come from another window's `Element`.
 */
const asElement = (target: EventTarget | null): Element | null =>
  target && (target as Node).nodeType === 1 ? (target as Element) : null;

function isTyping(el: Element): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/**
 * The page turn a key press asks for, or null when it should keep its usual meaning:
 * ← and Page Up go back, → and Page Down go forward, Space goes forward and Shift+Space back.
 * Nothing turns while the focus is in a text field or a select (the keys move the caret there),
 * Space leaves a focused button alone (it presses it), and the arrows leave widgets that
 * use them alone. Shift+arrow and Shift+Page keys extend a text selection, so they don't turn.
 */
export function pageTurnFor(e: KeyboardEvent): PageTurn | null {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
  const target = asElement(e.target);
  if (target && isTyping(target)) return null;
  switch (e.key) {
    case ' ':
      if (target?.closest(SPACE_CONTROLS)) return null;
      return e.shiftKey ? -1 : 1;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (e.shiftKey || target?.closest(ARROW_WIDGETS)) return null;
      return e.key === 'ArrowLeft' ? -1 : 1;
    case 'PageUp':
    case 'PageDown':
      if (e.shiftKey) return null;
      return e.key === 'PageUp' ? -1 : 1;
    default:
      return null;
  }
}

/** Turns the page on the keys above, pressed anywhere in `target` (a window or a document). */
export function listenForPageKeys(target: Window | Document, turn: (dir: PageTurn) => void): () => void {
  const onKeyDown = (e: Event) => {
    const dir = pageTurnFor(e as KeyboardEvent);
    if (dir === null) return;
    // Space and Page Down would otherwise scroll as well.
    e.preventDefault();
    turn(dir);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
