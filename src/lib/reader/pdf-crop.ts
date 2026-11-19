/**
 * Finding the box that holds a PDF's content, so the reader can leave the white margins out
 * ("Crop white margins"). A page is drawn small and scanned for ink; the book gets one box, so
 * every page keeps the same size.
 */

/** A box on a page, as fractions of the page: its left, top, right and bottom edges. */
export type CropBox = { l: number; t: number; r: number; b: number };

/** The whole page. `bookBox` answers with this very object for a book not worth cropping. */
export const NO_CROP: CropBox = { l: 0, t: 0, r: 1, b: 1 };

// How much darker than the paper a pixel must be to count as ink (shades run 0 to 255).
const CONTRAST = 60;
// A row or column holds content when this share of it is ink...
const MIN_SHARE = 0.004;
// ...in a run of rows or columns this thick, as a share of the page. Anything thinner is a speck.
const MIN_RUN = 0.004;
// Room left around the content, as a share of the page: the faint edges of scanned letters fall under the contrast.
const PADDING = 0.015;
// A page sticks out of the book's box when its content passes it by more than this share of the page.
const STICKS_OUT = 0.01;
// Cropping away less than this share of the width is not worth the change.
const MIN_GAIN = 0.05;
// The width, in pixels, a page is drawn at to be scanned.
const SCAN_WIDTH = 400;
// How many of a book's pages are scanned at most.
const SAMPLES = 24;

/**
 * The box of the ink in a picture of a page (RGBA pixels, row by row), or null for a blank page.
 * The paper is the picture's commonest shade, so grey and yellowed scans work; ink is anything
 * clearly darker. A dark band along an edge (a scanner's border) is ink too, so the box reaches
 * that edge: such a page is cropped less, never cut.
 */
export function inkBox(rgba: ArrayLike<number>, width: number, height: number): CropBox | null {
  const luma = new Uint8Array(width * height);
  const shades = new Uint32Array(256);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    const shade = Math.floor((rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000);
    luma[i] = shade;
    shades[shade]++;
  }
  let paper = 255;
  for (let shade = 0; shade < 256; shade++) if (shades[shade] > shades[paper]) paper = shade;
  const limit = paper - CONTRAST;

  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luma[y * width + x] < limit) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const [top, bottom] = contentEnds(rows, width);
  const [left, right] = contentEnds(cols, height);
  if (top < 0 || left < 0) return null;
  return { l: left / width, t: top / height, r: (right + 1) / width, b: (bottom + 1) / height };
}

/**
 * The first and last line (row or column) that holds content, or -1 twice. `ink` is each line's
 * count of ink pixels and `length` how many pixels a line has.
 */
function contentEnds(ink: Uint32Array, length: number): [number, number] {
  const enough = Math.max(1, Math.round(length * MIN_SHARE));
  const thick = Math.max(1, Math.round(ink.length * MIN_RUN));
  let first = -1;
  let last = -1;
  for (let i = 0; i < ink.length; i++) {
    let run = 0;
    while (i + run < ink.length && ink[i + run] >= enough) run++;
    if (run >= thick) {
      if (first < 0) first = i;
      last = i + run - 1;
    }
    i += run;
  }
  return [first, last];
}

/** The value a share `q` of the way through the sorted values. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round(q * (sorted.length - 1))];
}

/**
 * One box for the whole book from its pages' boxes: wide enough for all but the oddest pages (a
 * cover, a stamp in the margin), plus some padding. `NO_CROP` when that would gain too little
 * width, or when there are no pages to go by.
 */
export function bookBox(pages: CropBox[]): CropBox {
  if (pages.length === 0) return NO_CROP;
  const box = {
    l: Math.max(0, quantile(pages.map((p) => p.l), 0.05) - PADDING),
    t: Math.max(0, quantile(pages.map((p) => p.t), 0.05) - PADDING),
    r: Math.min(1, quantile(pages.map((p) => p.r), 0.95) + PADDING),
    b: Math.min(1, quantile(pages.map((p) => p.b), 0.95) + PADDING),
  };
  return box.r - box.l > 1 - MIN_GAIN ? NO_CROP : box;
}

/** Whether a page's content reaches outside the book's box, so the box would cut it. */
export function sticksOut(page: CropBox, book: CropBox): boolean {
  return (
    page.l < book.l - STICKS_OUT ||
    page.t < book.t - STICKS_OUT ||
    page.r > book.r + STICKS_OUT ||
    page.b > book.b + STICKS_OUT
  );
}

/** A page's width and height where it is drawn, and how far its corner is from its slot's, rightwards and down. */
export type PagePlace = { width: number; height: number; left: number; top: number };

/**
 * Where a page goes in its slot. The slot is a window with the size of `box` on a page `width` by
 * `height` (the book's usual page, drawn whole): such a page is moved up and left so the window
 * shows the box. A page that must be shown whole (`ownAspect` is its own height / width) is made
 * as big as fits in the window, in its middle.
 */
export function placeInSlot(width: number, height: number, box: CropBox, ownAspect: number | null = null): PagePlace {
  if (ownAspect === null) return { width, height, left: -box.l * width, top: -box.t * height };
  const slotWidth = width * (box.r - box.l);
  const slotHeight = height * (box.b - box.t);
  const fitted = Math.min(slotWidth, slotHeight / ownAspect);
  return {
    width: fitted,
    height: fitted * ownAspect,
    left: (slotWidth - fitted) / 2,
    top: (slotHeight - fitted * ownAspect) / 2,
  };
}

/** The pages (1-based) scanned in a book of `numPages`: at most `SAMPLES`, spread evenly from the first. */
export function samplePages(numPages: number): number[] {
  const step = Math.max(1, Math.ceil(numPages / SAMPLES));
  const pages: number[] = [];
  for (let n = 1; n <= numPages; n += step) pages.push(n);
  return pages;
}

/**
 * The ink box of a page already drawn (its canvas), scanned from a small copy of it. Runs in the
 * browser. Null for a blank page, or when the browser gives no canvas to copy onto.
 */
export function inkBoxOfCanvas(source: HTMLCanvasElement): CropBox | null {
  if (source.width === 0 || source.height === 0) return null;
  const small = document.createElement('canvas');
  small.width = Math.min(SCAN_WIDTH, source.width);
  small.height = Math.max(1, Math.round((source.height * small.width) / source.width));
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, small.width, small.height);
  return inkBox(context.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
}

/** The slice of pdf.js's document proxy used here (see `PDFDocumentProxy` in pdfjs-dist). */
export type PdfCropSource<Viewport extends { width: number; height: number } = { width: number; height: number }> = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(params: { scale: number }): Viewport;
    render(params: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: Viewport }): {
      promise: Promise<unknown>;
    };
  }>;
};

/**
 * The book's box, from small drawings of pages spread through the book. Runs in the browser.
 * Null when `isCancelled` answers true between two pages, or when the browser gives no canvas.
 */
export async function detectCrop<Viewport extends { width: number; height: number }>(
  doc: PdfCropSource<Viewport>,
  isCancelled: () => boolean = () => false,
): Promise<CropBox | null> {
  const boxes: CropBox[] = [];
  for (const n of samplePages(doc.numPages)) {
    if (isCancelled()) return null;
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: SCAN_WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
    if (!canvasContext) return null;
    await page.render({ canvas, canvasContext, viewport }).promise;
    const box = inkBox(canvasContext.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (box) boxes.push(box);
  }
  return isCancelled() ? null : bookBox(boxes);
}

// Bump when the detection changes, so boxes found the old way are found again.
const SAVED_VERSION = 1;
const savedKey = (bookId: string) => `hmr.pdfCrop.${bookId}`;
const isShare = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1;

/** A book's box as it is stored: `NO_CROP` is stored as "not worth cropping", so it is not looked for again. */
export function serializeCrop(box: CropBox): string {
  return JSON.stringify({ v: SAVED_VERSION, box: box === NO_CROP ? null : box });
}

/** The box stored by `serializeCrop`, or null when nothing usable is stored (missing, damaged, or from an older detection). */
export function parseCrop(stored: string | null): CropBox | null {
  if (!stored) return null;
  try {
    const { v, box } = JSON.parse(stored) as { v?: unknown; box?: Partial<CropBox> | null };
    if (v !== SAVED_VERSION || box === undefined) return null;
    if (box === null) return NO_CROP;
    const { l, t, r, b } = box;
    return isShare(l) && isShare(t) && isShare(r) && isShare(b) && l < r && t < b ? { l, t, r, b } : null;
  } catch {
    return null;
  }
}

/** The box found for the book on this device before, or null. Kept in localStorage, like the reading preferences. */
export function savedCrop(bookId: string): CropBox | null {
  try {
    return parseCrop(localStorage.getItem(savedKey(bookId)));
  } catch {
    return null;
  }
}

/** Remembers the book's box on this device, so the next open needs no detection. */
export function saveCrop(bookId: string, box: CropBox): void {
  try {
    localStorage.setItem(savedKey(bookId), serializeCrop(box));
  } catch {
    // the box is just found again next time
  }
}
