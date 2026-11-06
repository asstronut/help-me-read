/**
 * The book's table of contents, as the outline beside the book shows it: two levels at most
 * (e.g. Volume › Chapter). EPUB contents come from foliate-js, PDF contents from the file's
 * bookmarks through pdf.js.
 */

/** Where an entry goes: an EPUB href or a PDF page (1-based); null when it goes nowhere. */
export type ContentsTarget = { href: string } | { page: number } | null;

export type ContentsItem = {
  /** Unique in the outline. */
  id: string;
  label: string;
  target: ContentsTarget;
  /** The second level; deeper entries are left out (their place counts as their parent's). */
  children: ContentsItem[];
};

/** foliate-js's table-of-contents entry (it gives each one a numeric `id` when it opens the book). */
export type TocEntry = {
  id?: number;
  label?: string;
  href?: string;
  subitems?: TocEntry[] | null;
};

const tidy = (label: string | undefined) => (label ?? '').replace(/\s+/g, ' ').trim();

/** Every foliate id in the entry and below it. */
function idsIn(entry: TocEntry): number[] {
  return [...(entry.id === undefined ? [] : [entry.id]), ...(entry.subitems ?? []).flatMap(idsIn)];
}

export type EpubContents = {
  items: ContentsItem[];
  /** The shown entry (its id) for each foliate entry id, so a deeper entry marks its level-2 parent. */
  shownFor: Map<number, string>;
};

/** The EPUB's contents from foliate's `book.toc`. */
export function epubContents(toc: readonly TocEntry[] | null | undefined): EpubContents {
  const shownFor = new Map<number, string>();
  let next = 0;
  const make = (entry: TocEntry, depth: 1 | 2): ContentsItem => {
    const id = `toc-${next++}`;
    if (entry.id !== undefined) shownFor.set(entry.id, id);
    const children = depth === 1 ? (entry.subitems ?? []).map((sub) => make(sub, 2)) : [];
    if (depth === 2) for (const deeper of (entry.subitems ?? []).flatMap(idsIn)) shownFor.set(deeper, id);
    return {
      id,
      label: tidy(entry.label) || 'Untitled',
      target: entry.href ? { href: entry.href } : null,
      children,
    };
  };
  return { items: (toc ?? []).map((entry) => make(entry, 1)), shownFor };
}

/** The slice of pdf.js's document proxy used here (see `PDFDocumentProxy` in pdfjs-dist). */
export type PdfOutlineSource = {
  getOutline(): Promise<PdfOutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
};
export type PdfOutlineNode = {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineNode[];
};

/**
 * The page (1-based) a bookmark goes to, or null. A destination is a name, or an array whose first
 * element is the page: a reference to it, or (in some files) its 0-based index.
 */
async function pageOf(pdf: PdfOutlineSource, dest: PdfOutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    const ref = explicit?.[0];
    if (typeof ref === 'number') return ref + 1;
    if (ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref) {
      return (await pdf.getPageIndex(ref as { num: number; gen: number })) + 1;
    }
    return null;
  } catch {
    return null;
  }
}

/** The PDF's contents from its bookmarks; empty when it has none. Never rejects. */
export async function pdfContents(pdf: PdfOutlineSource): Promise<ContentsItem[]> {
  let outline: PdfOutlineNode[] | null;
  try {
    outline = await pdf.getOutline();
  } catch {
    return [];
  }
  let next = 0;
  const make = async (node: PdfOutlineNode, depth: 1 | 2): Promise<ContentsItem> => {
    const id = `pdf-${next++}`;
    const page = await pageOf(pdf, node.dest);
    const children = depth === 1 ? await Promise.all((node.items ?? []).map((sub) => make(sub, 2))) : [];
    return {
      id,
      label: tidy(node.title) || 'Untitled',
      target: page === null ? null : { page },
      children,
    };
  };
  return Promise.all((outline ?? []).map((node) => make(node, 1)));
}

/** Every entry, parents before their children, in book order as listed. */
export const flatten = (items: readonly ContentsItem[]): ContentsItem[] =>
  items.flatMap((item) => [item, ...item.children]);

const pageOfItem = (item: ContentsItem) => (item.target && 'page' in item.target ? item.target.page : null);

/**
 * The entry a PDF page belongs to: the last one (in listed order) that starts on or before the page.
 * A chapter that starts on the same page as its volume wins over the volume.
 */
export function currentPdfItem(items: readonly ContentsItem[], page: number): ContentsItem | null {
  let best: ContentsItem | null = null;
  let bestPage = 0;
  for (const item of flatten(items)) {
    const start = pageOfItem(item);
    if (start !== null && start <= page && start >= bestPage) {
      best = item;
      bestPage = start;
    }
  }
  return best;
}

/** The entry with this id, and its parent when it is on the second level. */
export function findItem(
  items: readonly ContentsItem[],
  id: string | null,
): { item: ContentsItem; parent: ContentsItem | null } | null {
  if (id === null) return null;
  for (const item of items) {
    if (item.id === id) return { item, parent: null };
    const child = item.children.find((c) => c.id === id);
    if (child) return { item: child, parent: item };
  }
  return null;
}
