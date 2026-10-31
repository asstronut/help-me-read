// foliate-js ships no types; this declares the slice of it the app uses.
declare module 'foliate-js/view.js' {
  export type TocItem = { label?: string; href?: string; subitems?: TocItem[] | null };
  export type FoliateBook = {
    sections: { id: string; createDocument: () => Promise<Document> }[];
    toc?: TocItem[] | null;
  };
  export function makeBook(file: File): Promise<FoliateBook>;
}
