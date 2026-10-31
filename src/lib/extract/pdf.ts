import type { Segment } from '@/lib/types';
import { cleanParagraphs } from './paragraphs';

const PARAGRAPH_GAP = 1.5; // times line height

type Line = { text: string; y: number; height: number };

/** Groups a page's text items into lines, top to bottom. */
function toLines(
  items: { str: string; transform: number[]; height: number }[],
): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  for (const item of items) {
    const y = item.transform[5];
    if (!current || Math.abs(current.y - y) > Math.max(current.height, item.height) / 2) {
      current = { text: '', y, height: item.height };
      lines.push(current);
    }
    current.text += item.str;
    current.height = Math.max(current.height, item.height);
  }
  return lines.filter((l) => l.text.trim() !== '');
}

function toParagraphs(lines: Line[]): string[] {
  const paragraphs: string[] = [];
  let text = '';
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    if (prev && prev.y - line.y > PARAGRAPH_GAP * Math.max(prev.height, line.height)) {
      paragraphs.push(text);
      text = '';
    }
    const piece = line.text.trim();
    if (text.endsWith('-')) text = text.slice(0, -1) + piece;
    else text = text === '' ? piece : `${text} ${piece}`;
  });
  paragraphs.push(text);
  return cleanParagraphs(paragraphs);
}

/** One segment per page. Runs in the browser. */
export async function extractPdfSegments(data: ArrayBuffer): Promise<Segment[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  try {
    const doc = await task.promise;
    const segments: Segment[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (i): i is typeof i & { str: string; transform: number[]; height: number } => 'str' in i,
      );
      segments.push({
        seq: n - 1,
        label: `Page ${n}`,
        paragraphs: toParagraphs(toLines(items)),
      });
    }
    return segments;
  } finally {
    await task.destroy();
  }
}
