// foliate-js ships no types; this declares the slice of it the app uses.
declare module 'foliate-js/view.js' {
  export type TocItem = { label?: string; href?: string; subitems?: TocItem[] | null };
  export type FoliateBook = {
    sections: { id: string; createDocument: () => Promise<Document> }[];
    toc?: TocItem[] | null;
  };
  export function makeBook(file: File): Promise<FoliateBook>;

  export type RelocateDetail = { cfi: string };
  export class View extends HTMLElement {
    renderer: HTMLElement & { setStyles(styles: string): void };
    open(book: string): Promise<void>;
    init(options: { lastLocation: string | null; showTextStart?: boolean }): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    close(): void;
  }
}
