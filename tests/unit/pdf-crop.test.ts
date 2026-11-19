import { expect, test } from 'vitest';
import { NO_CROP, bookBox, inkBox, samplePages, sticksOut, type CropBox } from '../../src/lib/reader/pdf-crop';

// The size a page is scanned at: about 400px wide.
const W = 400;
const H = 600;
const INK = 20;

type Mark = { x: number; y: number; w: number; h: number; shade?: number; lines?: boolean };

/** A picture of a page, W by H: paper of one shade with rectangles of ink on it, solid or as lines of text. */
function picture(paper: number, marks: Mark[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  const paint = (x: number, y: number, shade: number) => rgba.fill(shade, (y * W + x) * 4, (y * W + x) * 4 + 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paint(x, y, paper);
  for (const m of marks) {
    for (let y = m.y; y < m.y + m.h; y++) {
      // Lines of text: 2px of ink, 2px of paper. As on a real page, most of the picture stays paper.
      if (m.lines && (y - m.y) % 4 >= 2 && y < m.y + m.h - 2) continue;
      for (let x = m.x; x < m.x + m.w; x++) paint(x, y, m.shade ?? INK);
    }
  }
  return rgba;
}

// A block of text 40px in from the left, 60 from the top, 80 from the right and 120 from the bottom.
const TEXT: Mark = { x: 40, y: 60, w: 280, h: 420, lines: true };
const TEXT_BOX: CropBox = { l: 0.1, t: 0.1, r: 0.8, b: 0.8 };

test('the box of the ink on white paper', () => {
  expect(inkBox(picture(255, [TEXT]), W, H)).toEqual(TEXT_BOX);
});

test('the paper may be grey: ink is what is clearly darker than it', () => {
  expect(inkBox(picture(200, [TEXT]), W, H)).toEqual(TEXT_BOX);
});

test('a shade only a little darker than the paper is not ink', () => {
  const stain: Mark = { x: 0, y: 0, w: 30, h: H, shade: 215 };
  expect(inkBox(picture(255, [TEXT, stain]), W, H)).toEqual(TEXT_BOX);
});

test('a blank page has no box', () => {
  expect(inkBox(picture(255, []), W, H)).toBeNull();
  expect(inkBox(picture(180, []), W, H)).toBeNull();
});

test('specks of one pixel in the margins are ignored', () => {
  const specks: Mark[] = [
    { x: 10, y: 16, w: 1, h: 1 },
    { x: 380, y: 300, w: 1, h: 1 },
    { x: 200, y: 580, w: 1, h: 1 },
  ];
  expect(inkBox(picture(255, [TEXT, ...specks]), W, H)).toEqual(TEXT_BOX);
});

test('a page with nothing but specks has no box', () => {
  expect(inkBox(picture(255, [{ x: 100, y: 100, w: 1, h: 1 }]), W, H)).toBeNull();
});

test('a dark band along an edge is kept inside the box, so the page is not cut', () => {
  const band: Mark = { x: 0, y: 0, w: 12, h: H };
  expect(inkBox(picture(255, [TEXT, band]), W, H)).toEqual({ ...TEXT_BOX, l: 0, t: 0, b: 1 });
});

test('a page with a dark border all round is not cropped at all', () => {
  const border: Mark[] = [
    { x: 0, y: 0, w: W, h: 10 },
    { x: 0, y: H - 10, w: W, h: 10 },
    { x: 0, y: 0, w: 10, h: H },
    { x: W - 10, y: 0, w: 10, h: H },
  ];
  const box = inkBox(picture(210, [TEXT, ...border]), W, H);
  expect(box).toEqual(NO_CROP);
  expect(bookBox([box!, box!, box!])).toBe(NO_CROP);
});

test("the book's box is the pages' box with some padding", () => {
  const box = bookBox([TEXT_BOX, TEXT_BOX, TEXT_BOX]);
  expect(box.l).toBeCloseTo(0.085);
  expect(box.t).toBeCloseTo(0.085);
  expect(box.r).toBeCloseTo(0.815);
  expect(box.b).toBeCloseTo(0.815);
});

test('one odd page among many does not decide the box', () => {
  const stamped: CropBox = { ...TEXT_BOX, l: 0.02 };
  const pages = [stamped, ...Array.from({ length: 23 }, () => TEXT_BOX)];
  expect(bookBox(pages).l).toBeCloseTo(0.085);
  expect(sticksOut(stamped, bookBox(pages))).toBe(true);
});

test('the padding stops at the edge of the page', () => {
  const box = bookBox([{ l: 0.005, t: 0.005, r: 0.7, b: 0.999 }]);
  expect(box.l).toBe(0);
  expect(box.t).toBe(0);
  expect(box.b).toBe(1);
});

test('a book that would gain too little width is not cropped', () => {
  // 0.02 + 0.015 padding on each side leaves 93% of the width: under the 5% gain.
  expect(bookBox([{ l: 0.02, t: 0.2, r: 0.98, b: 0.8 }])).toBe(NO_CROP);
  // 0.06 on each side leaves 91%.
  expect(bookBox([{ l: 0.06, t: 0.2, r: 0.94, b: 0.8 }])).not.toBe(NO_CROP);
});

test('a book with no pages to go by is not cropped', () => {
  expect(bookBox([])).toBe(NO_CROP);
});

test('a page sticks out when its content passes the box by more than 1% of the page', () => {
  const book: CropBox = { l: 0.1, t: 0.1, r: 0.9, b: 0.9 };
  expect(sticksOut({ l: 0.2, t: 0.2, r: 0.8, b: 0.8 }, book)).toBe(false);
  expect(sticksOut(book, book)).toBe(false);
  expect(sticksOut({ ...book, l: 0.095 }, book)).toBe(false);
  expect(sticksOut({ ...book, l: 0.085 }, book)).toBe(true);
  expect(sticksOut({ ...book, t: 0.085 }, book)).toBe(true);
  expect(sticksOut({ ...book, r: 0.915 }, book)).toBe(true);
  expect(sticksOut({ ...book, b: 0.915 }, book)).toBe(true);
});

test('a short book is scanned whole, a long one at 24 pages spread through it', () => {
  expect(samplePages(0)).toEqual([]);
  expect(samplePages(3)).toEqual([1, 2, 3]);
  expect(samplePages(24)).toHaveLength(24);
  const long = samplePages(883);
  expect(long).toHaveLength(24);
  expect(long[0]).toBe(1);
  expect(long[1]).toBe(38);
  expect(long.at(-1)).toBeGreaterThan(883 - 38);
});
