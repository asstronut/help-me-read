/**
 * PROTOTYPE (issue #37, not for merging as is): finding the box that holds a PDF's content, so the
 * reader can leave the white margins out.
 */

/** A box on a page, as fractions of the page: its left, top, right and bottom edges. */
export type CropBox = { l: number; t: number; r: number; b: number };

export const NO_CROP: CropBox = { l: 0, t: 0, r: 1, b: 1 };

// How much darker than the paper a pixel must be to count as ink (0 to 255).
const CONTRAST = 60;
// A row or column holds content when this share of it is ink, in a run of rows this thick (a share of the page).
const MIN_SHARE = 0.004;
const MIN_RUN = 0.004;
// Room left around the content, as a share of the page: faint edges of a scan fall under the contrast.
const PADDING = 0.015;
// A page sticks out of the book's box when its content passes it by more than this share of the page.
const STICKS_OUT = 0.01;
// Cropping less than this much of the width is not worth the change.
const MIN_GAIN = 0.05;
// The width a page is drawn at to be scanned, and how many pages of a book are scanned.
const SCAN_WIDTH = 400;
const SAMPLES = 24;

/**
 * The box of the ink in a picture of a page (RGBA pixels), or null for a blank page. The paper is
 * the picture's commonest shade, so grey and yellowed scans work; thin runs of ink are specks.
 */
export function inkBox(rgba: Uint8ClampedArray, w: number, h: number): CropBox | null {
  const luma = new Uint8Array(w * h);
  const shades = new Uint32Array(256);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    const v = ((rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000) | 0;
    luma[i] = v;
    shades[v]++;
  }
  let paper = 255;
  for (let v = 0; v < 256; v++) if (shades[v] > shades[paper]) paper = v;
  const limit = paper - CONTRAST;
  const rows = new Uint32Array(h);
  const cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (luma[y * w + x] < limit) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  /** The first and last index of the runs of lines with enough ink. */
  const ends = (counts: Uint32Array, across: number): [number, number] => {
    const need = Math.max(1, Math.round(across * MIN_SHARE));
    const run = Math.max(1, Math.round(counts.length * MIN_RUN));
    let first = -1;
    let last = -1;
    for (let i = 0; i < counts.length; i++) {
      let k = 0;
      while (i + k < counts.length && counts[i + k] >= need) k++;
      if (k >= run) {
        if (first < 0) first = i;
        last = i + k - 1;
      }
      i += k;
    }
    return [first, last];
  };
  const [top, bottom] = ends(rows, w);
  const [left, right] = ends(cols, h);
  if (top < 0 || left < 0) return null;
  return { l: left / w, t: top / h, r: (right + 1) / w, b: (bottom + 1) / h };
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round(q * (sorted.length - 1))];
};

/**
 * One box for the whole book from its pages' boxes, so every page keeps the same size: wide enough
 * for all but the oddest pages (a cover, a stamp in the margin), plus some padding.
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

/** Whether a page's content reaches outside the book's box. */
export function sticksOut(page: CropBox, book: CropBox): boolean {
  return (
    page.l < book.l - STICKS_OUT ||
    page.t < book.t - STICKS_OUT ||
    page.r > book.r + STICKS_OUT ||
    page.b > book.b + STICKS_OUT
  );
}

/** The ink box of a picture already drawn (a page's canvas), scanned from a small copy of it. */
export function inkBoxOfCanvas(source: HTMLCanvasElement): CropBox | null {
  if (source.width === 0 || source.height === 0) return null;
  const small = document.createElement('canvas');
  small.width = Math.min(SCAN_WIDTH, source.width);
  small.height = Math.max(1, Math.round((source.height * small.width) / source.width));
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, small.width, small.height);
  return inkBox(ctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
}

/** The slice of pdf.js's document proxy used here. */
type PdfDocument = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(params: { scale: number }): { width: number; height: number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(params: any): { promise: Promise<unknown> };
  }>;
};

/** The book's box, from small drawings of pages spread through the book. */
export async function detectCrop(doc: PdfDocument, isCancelled: () => boolean): Promise<CropBox | null> {
  const step = Math.max(1, Math.ceil(doc.numPages / SAMPLES));
  const boxes: CropBox[] = [];
  for (let n = 1; n <= doc.numPages; n += step) {
    if (isCancelled()) return null;
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: SCAN_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
    if (!canvasContext) return null;
    await page.render({ canvas, canvasContext, viewport }).promise;
    const box = inkBox(canvasContext.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (box) boxes.push(box);
  }
  return bookBox(boxes);
}
