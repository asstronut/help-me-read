// foliate-js ships no types; this declares the slice of it the app uses.
declare module 'foliate-js/view.js' {
  /** A table-of-contents entry; `id` is numbered by the view when it opens the book (TOCProgress). */
  export type TocItem = { id?: number; label?: string; href?: string; subitems?: TocItem[] | null };
  export type FoliateBook = {
    sections: { id: string; createDocument: () => Promise<Document> }[];
    toc?: TocItem[] | null;
  };
  export function makeBook(file: File): Promise<FoliateBook>;

  /**
   * Detail of the view's `relocate` event. `fraction` is how far through the whole book the
   * current page ends, 0 to 1 (by section sizes; see SectionProgress in progress.js). `tocItem`
   * is the deepest table-of-contents entry the page is in (TOCProgress.getProgress).
   */
  export type RelocateDetail = { cfi: string; fraction?: number; tocItem?: TocItem | null };
  /** Detail of the view's `load` event: a section's document has been rendered. */
  export type SectionLoadDetail = { doc: Document; index: number };
  export class View extends HTMLElement {
    renderer: HTMLElement & { setStyles(styles: string): void };
    /** The opened book (set by `open`). */
    book: FoliateBook;
    open(book: string): Promise<void>;
    /** Goes to an href from the table of contents, or a CFI. */
    goTo(target: string): Promise<unknown>;
    init(options: { lastLocation: string | null; showTextStart?: boolean }): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    close(): void;
    getCFI(index: number, range: Range): string;
    /** Draws (via the `draw-annotation` event) the annotation in its section, when that section is shown. */
    addAnnotation(annotation: Annotation): Promise<unknown>;
    deleteAnnotation(annotation: Annotation): Promise<unknown>;
  }
  /** An annotation is keyed by its CFI. */
  export type Annotation = { value: string };
  export type DrawFn = (rects: DOMRect[], options?: Record<string, unknown>) => SVGElement;
  /** Detail of `draw-annotation`: call `draw` with an Overlayer drawing function. */
  export type DrawAnnotationDetail = {
    draw: (fn: DrawFn, options?: Record<string, unknown>) => void;
    annotation: Annotation;
  };
  /** Detail of `show-annotation`: an annotation was tapped. */
  export type ShowAnnotationDetail = { value: string };
}

declare module 'foliate-js/epubcfi.js' {
  /** Orders two CFIs by their place in the book: negative, zero or positive. */
  export function compare(a: string, b: string): number;
}

declare module 'foliate-js/overlayer.js' {
  import type { DrawFn } from 'foliate-js/view.js';
  export class Overlayer {
    static highlight: DrawFn;
    static underline: DrawFn;
  }
}
