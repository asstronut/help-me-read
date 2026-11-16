/* eslint-disable @typescript-eslint/no-unused-expressions */
// PROTOTYPE research script for issue #37. Usage, from the repo root:
//   node scripts/research/crop-margins/measure.mjs file.pdf [maxPages] [out.json] [truth.json]
// PAD=0.015 pads the boxes; EDGE=1 drops dark bands at the sheet edges.
// Boxes are fractions of the visible page: {l, t, r, b}, each 0..1 from the left/top edge.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const REPO = process.cwd() + '/node_modules/'; // run from the repo root
const pdfjs = await import(REPO + 'pdfjs-dist/legacy/build/pdf.mjs');
const require = createRequire(REPO);
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument } = require('pdf-lib');

const [file, maxArg, outJson, truthFile] = process.argv.slice(2);
const truth = truthFile ? JSON.parse(readFileSync(truthFile, 'utf8')) : null;
const MAX = Number(maxArg ?? 80);
const data = readFileSync(file);

// ---- 1. the file's own boxes (pdf-lib reads the raw page dictionary) ----
function fileBoxes() {
  return PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false }).then((doc) => {
    let differs = 0;
    const kinds = { crop: 0, trim: 0, art: 0 };
    const pages = doc.getPages();
    for (const p of pages) {
      const m = p.getMediaBox();
      const same = (b) => Math.abs(b.x - m.x) < 1 && Math.abs(b.y - m.y) < 1 && Math.abs(b.width - m.width) < 1 && Math.abs(b.height - m.height) < 1;
      let any = false;
      if (!same(p.getCropBox())) (kinds.crop++, (any = true));
      if (!same(p.getTrimBox())) (kinds.trim++, (any = true));
      if (!same(p.getArtBox())) (kinds.art++, (any = true));
      if (any) differs++;
    }
    return { pages: pages.length, pagesWithABoxSmallerThanMedia: differs, ...kinds };
  });
}

// ---- 2. text bounding box ----
async function textBox(page, viewport) {
  const content = await page.getTextContent();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, n = 0;
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    // Baseline start in viewport pixels; the run goes along (m[0], m[1]), its height along (m[2], m[3]).
    const len = Math.hypot(m[0], m[1]) || 1;
    const ux = m[0] / len, uy = m[1] / len;
    const w = item.width * viewport.scale, h = item.height * viewport.scale;
    const pts = [
      [m[4], m[5]],
      [m[4] + ux * w, m[5] + uy * w],
      [m[4] + uy * h, m[5] - ux * h],
      [m[4] + ux * w + uy * h, m[5] + uy * w - ux * h],
      // descenders: a quarter of the height below the baseline
      [m[4] - uy * h * 0.25, m[5] + ux * h * 0.25],
      [m[4] + ux * w - uy * h * 0.25, m[5] + uy * w + ux * h * 0.25],
    ];
    for (const [x, y] of pts) {
      l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
    }
    n++;
  }
  if (n === 0) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return { l: clamp(l / viewport.width), t: clamp(t / viewport.height), r: clamp(r / viewport.width), b: clamp(b / viewport.height) };
}

// ---- 3. pixel scan of a small render ----
async function render(page, widthPx, recordOperations = false) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: widthPx / base.width });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, canvas, viewport, recordOperations }).promise;
  return { canvas, ctx, viewport };
}

/**
 * The box of the "ink": pixels clearly darker than the paper. The paper's shade is the commonest
 * shade on the page, so grey or yellowed scans work. A row or column counts only when enough of
 * it is ink, and thin isolated runs are dropped, which ignores specks.
 */
export function inkBox(img, w, h, { contrast = 60, minShare = 0.004, minRun = 0.004 } = {}) {
  const hist = new Uint32Array(256);
  const luma = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    const v = (img[p] * 299 + img[p + 1] * 587 + img[p + 2] * 114) / 1000 | 0;
    luma[i] = v; hist[v]++;
  }
  let paper = 255, best = 0;
  for (let v = 0; v < 256; v++) if (hist[v] > best) (best = hist[v], (paper = v));
  const limit = paper - contrast;
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (luma[y * w + x] < limit) (rows[y]++, cols[x]++);
  if (process.env.EDGE) {
    // Dark bands that touch the sheet's edge (scanner bed, gutter shadow) are not content: walking in
    // from each edge, drop rows/columns that are mostly dark, up to 10% of the page.
    const strip = (counts, across) => {
      const max = Math.round(counts.length * 0.1);
      for (let i = 0; i < max && counts[i] > across * 0.4; i++) counts[i] = 0;
      for (let i = counts.length - 1; i >= counts.length - max && counts[i] > across * 0.4; i--) counts[i] = 0;
    };
    const r0 = rows.slice(), c0 = cols.slice();
    strip(rows, w); strip(cols, h);
    // a dropped column also put a dark pixel in every row (and the other way round): take those out
    let dc = 0, dr = 0;
    for (let x = 0; x < w; x++) if (c0[x] && !cols[x]) dc++;
    for (let y = 0; y < h; y++) if (r0[y] && !rows[y]) dr++;
    for (let y = 0; y < h; y++) rows[y] = Math.max(0, rows[y] - dc);
    for (let x = 0; x < w; x++) cols[x] = Math.max(0, cols[x] - dr);
  }
  const edge = (counts, across, along) => {
    const need = Math.max(1, Math.round(across * minShare));
    const run = Math.max(1, Math.round(along * minRun));
    const ok = (i) => counts[i] >= need;
    let a = -1, z = -1;
    for (let i = 0; i < counts.length; i++) {
      let k = 0; while (i + k < counts.length && ok(i + k)) k++;
      if (k >= run) { a = i; break; }
      i += k;
    }
    for (let i = counts.length - 1; i >= 0; i--) {
      let k = 0; while (i - k >= 0 && ok(i - k)) k++;
      if (k >= run) { z = i; break; }
      i -= k;
    }
    return [a, z];
  };
  const [t, b] = edge(rows, w, h);
  const [l, r] = edge(cols, h, w);
  if (t < 0 || l < 0) return null;
  return { l: l / w, t: t / h, r: (r + 1) / w, b: (b + 1) / h, paper };
}

async function pixelBox(page, widthPx, opts) {
  const { ctx, canvas } = await render(page, widthPx);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return inkBox(img, canvas.width, canvas.height, opts);
}

// ---- 4. pdf.js's recorded operation boxes (needs a render too) ----
async function opsBox(page, widthPx) {
  const { canvas } = await render(page, widthPx, true);
  const rec = page.recordedBBoxes;
  if (!rec) return null;
  let l = 1, t = 1, r = 0, b = 0, n = 0;
  const len = rec.length ?? 0;
  for (let i = 0; i < len; i++) {
    if (rec.isEmpty?.(i)) continue;
    const x0 = rec.minX(i), y0 = rec.minY(i), x1 = rec.maxX(i), y1 = rec.maxY(i);
    if (!(x1 > x0 && y1 > y0)) continue;
    l = Math.min(l, x0); t = Math.min(t, y0); r = Math.max(r, x1); b = Math.max(b, y1); n++;
  }
  void canvas;
  return n ? { l, t, r, b } : null;
}

const ms = async (fn) => { const t0 = performance.now(); const v = await fn(); return [v, performance.now() - t0]; };
const pct = (v) => (v * 100).toFixed(1);
const fmt = (bx) => (bx ? `L${pct(bx.l)} T${pct(bx.t)} R${pct(1 - bx.r)} B${pct(1 - bx.b)}` : 'none');
const TOL = 0.01; // a box "cuts" content when it sits more than 1% of the page inside the reference
const PAD = Number(process.env.PAD ?? 0);
const pad = (b) => b && ({ ...b, l: Math.max(0, b.l - PAD), t: Math.max(0, b.t - PAD), r: Math.min(1, b.r + PAD), b: Math.min(1, b.b + PAD) });
const cuts = (bx, ref) => !bx || bx.l > ref.l + TOL || bx.t > ref.t + TOL || bx.r < ref.r - TOL || bx.b < ref.b - TOL;
const slack = (bx, ref) => Math.max(ref.l - bx.l, ref.t - bx.t, bx.r - ref.r, bx.b - ref.b);

const doc = await pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, standardFontDataUrl: REPO + 'pdfjs-dist/standard_fonts/', cMapUrl: REPO + 'pdfjs-dist/cmaps/', wasmUrl: REPO + 'pdfjs-dist/wasm/', iccUrl: REPO + 'pdfjs-dist/iccs/' }).promise;
const step = Math.max(1, Math.ceil(doc.numPages / MAX));
const rows = [];
const time = { text: 0, px100: 0, px200: 0, px400: 0, ops: 0, ref: 0 };
let opsWorked = 0;
for (let n = 1; n <= doc.numPages; n += step) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  let [ref, tr] = await ms(() => pixelBox(page, 1000, { contrast: 40, minShare: 0.001, minRun: 0.001 }));
  if (truth) ref = truth[n - 1];
  const [text, tt] = await ms(() => textBox(page, vp));
  const [p100, t1] = await ms(() => pixelBox(page, 100));
  const [p200, t2] = await ms(() => pixelBox(page, 200));
  const [p400, t4] = await ms(() => pixelBox(page, 400));
  let ops = null, to = 0;
  try { [ops, to] = await ms(() => opsBox(page, 200)); if (ops) opsWorked++; } catch { ops = null; }
  time.ref += tr; time.text += tt; time.px100 += t1; time.px200 += t2; time.px400 += t4; time.ops += to;
  rows.push({ n, w: vp.width, h: vp.height, ref, text: pad(text), p100: pad(p100), p200: pad(p200), p400: pad(p400), ops });
  page.cleanup();
}

const N = rows.length;
const withInk = rows.filter((r) => r.ref);
const report = (key) => {
  const none = withInk.filter((r) => !r[key]).length;
  const cut = withInk.filter((r) => r[key] && cuts(r[key], r.ref)).length;
  const loose = withInk.filter((r) => r[key] && !cuts(r[key], r.ref) && slack(r[key], r.ref) > 0.03).length;
  return `none ${none}, cuts content ${cut}, >3% loose ${loose} (of ${withInk.length} pages with ink)`;
};
const sizes = new Set(rows.map((r) => `${Math.round(r.w)}x${Math.round(r.h)}`));
console.log(`\n=== ${file.split('/').pop()}: ${doc.numPages} pages, sampled ${N} (every ${step})`);
console.log('page sizes (pt):', [...sizes].slice(0, 6).join(', '), sizes.size > 6 ? `… ${sizes.size} sizes` : '');
console.log('file boxes:', JSON.stringify(await fileBoxes().catch((e) => ({ error: String(e).slice(0, 80) }))));
console.log(`blank pages (no ink at 1000px): ${N - withInk.length}`);
console.log(`text box        ${(time.text / N).toFixed(1)} ms/page | ${report('text')}`);
console.log(`pixel @100px    ${(time.px100 / N).toFixed(1)} ms/page | ${report('p100')}`);
console.log(`pixel @200px    ${(time.px200 / N).toFixed(1)} ms/page | ${report('p200')}`);
console.log(`pixel @400px    ${(time.px400 / N).toFixed(1)} ms/page | ${report('p400')}`);
console.log(`ops boxes @200  ${(time.ops / N).toFixed(1)} ms/page | worked on ${opsWorked}/${N} | ${report('ops')}`);
console.log(`(reference: pixel @1000px, ${(time.ref / N).toFixed(0)} ms/page)`);

// Per-book boxes from the 200px scan.
const boxes = withInk.map((r) => r.p200).filter(Boolean);
const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
const union = { l: Math.min(...boxes.map((b) => b.l)), t: Math.min(...boxes.map((b) => b.t)), r: Math.max(...boxes.map((b) => b.r)), b: Math.max(...boxes.map((b) => b.b)) };
const p5 = { l: q(boxes.map((b) => b.l), 0.05), t: q(boxes.map((b) => b.t), 0.05), r: q(boxes.map((b) => b.r), 0.95), b: q(boxes.map((b) => b.b), 0.95) };
const med = { l: q(boxes.map((b) => b.l), 0.5), t: q(boxes.map((b) => b.t), 0.5), r: q(boxes.map((b) => b.r), 0.5), b: q(boxes.map((b) => b.b), 0.5) };
const gain = (b) => (1 / (b.r - b.l)).toFixed(2);
console.log(`per-page width gain (fit width): median x${q(boxes.map((b) => 1 / (b.r - b.l)), 0.5).toFixed(2)}, min x${Math.min(...boxes.map((b) => 1 / (b.r - b.l))).toFixed(2)}, max x${Math.max(...boxes.map((b) => 1 / (b.r - b.l))).toFixed(2)}`);
console.log(`book box, union of all pages:   ${fmt(union)}  gain x${gain(union)}`);
console.log(`book box, 5th/95th percentile:  ${fmt(p5)}  gain x${gain(p5)}  cuts ${withInk.filter((r) => cuts(p5, r.ref)).length} pages`);
console.log(`book box, median:               ${fmt(med)}  gain x${gain(med)}  cuts ${withInk.filter((r) => cuts(med, r.ref)).length} pages`);
const odd = boxes.filter((_, i) => withInk[i].n % 2 === 1), even = boxes.filter((_, i) => withInk[i].n % 2 === 0);
if (odd.length && even.length) console.log(`left margin median: odd pages ${pct(q(odd.map((b) => b.l), 0.5))}%, even pages ${pct(q(even.map((b) => b.l), 0.5))}%`);
const bad = withInk.filter((r) => cuts(r.text, r.ref)).slice(0, 6);
if (bad.length) console.log('text-box misses, e.g.:\n' + bad.map((r) => `  p${r.n} text ${fmt(r.text)} | ref ${fmt(r.ref)}`).join('\n'));
const bad2 = withInk.filter((r) => cuts(r.p200, r.ref)).slice(0, 6);
if (bad2.length) console.log('pixel@200 misses, e.g.:\n' + bad2.map((r) => `  p${r.n} px ${fmt(r.p200)} | ref ${fmt(r.ref)}`).join('\n'));
if (outJson) writeFileSync(outJson, JSON.stringify(rows));
await doc.loadingTask.destroy();
