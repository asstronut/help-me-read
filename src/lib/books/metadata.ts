import JSZip from 'jszip';
import type { BookFormat } from '@/lib/types';

export type BookMetadata = { title: string; author: string | null };

const DC = 'http://purl.org/dc/elements/1.1/';

const filenameTitle = (name: string) => name.replace(/\.[^.]+$/, '');
const clean = (value: string | null | undefined) => value?.trim() || null;

async function pdfMetadata(file: File): Promise<Partial<BookMetadata>> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const doc = await task.promise;
    const { info } = await doc.getMetadata();
    const fields = info as { Title?: string; Author?: string };
    return {
      title: clean(fields.Title) ?? undefined,
      author: clean(fields.Author),
    };
  } finally {
    await task.destroy();
  }
}

async function epubMetadata(file: File): Promise<Partial<BookMetadata>> {
  const zip = await JSZip.loadAsync(file);
  const parser = new DOMParser();
  const readXml = async (path: string) => {
    const text = await zip.file(path)?.async('string');
    return text ? parser.parseFromString(text, 'application/xml') : null;
  };
  const container = await readXml('META-INF/container.xml');
  const opfPath = container?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  const opf = opfPath ? await readXml(opfPath) : null;
  if (!opf) return {};
  return {
    title: clean(opf.getElementsByTagNameNS(DC, 'title')[0]?.textContent) ?? undefined,
    author: clean(opf.getElementsByTagNameNS(DC, 'creator')[0]?.textContent),
  };
}

/** Reads the book's own title and author; falls back to the file name. Runs in the browser. */
export async function readMetadata(file: File, format: BookFormat): Promise<BookMetadata> {
  let found: Partial<BookMetadata> = {};
  try {
    found = format === 'pdf' ? await pdfMetadata(file) : await epubMetadata(file);
  } catch {
    // unreadable metadata is not fatal; the file name stands in
  }
  return {
    title: found.title ?? filenameTitle(file.name),
    author: found.author ?? null,
  };
}
