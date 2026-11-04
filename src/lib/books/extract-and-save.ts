import { extractEpubSegments } from '@/lib/extract/epub';
import { extractPdfSegments } from '@/lib/extract/pdf';
import { MAX_SEGMENT_BATCH, type BookFormat, type Segment } from '@/lib/types';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postBatch(bookId: string, segments: Segment[], done: boolean): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/books/${bookId}/segments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segments, done }),
      });
      if (res.ok) return;
      throw new Error(`Saving text failed (${res.status})`);
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Extracts the book's text in the browser and saves it in batches; the last batch marks it done. */
export async function extractAndSave(
  bookId: string,
  file: File,
  format: BookFormat,
): Promise<void> {
  const segments =
    format === 'pdf'
      ? await extractPdfSegments(await file.arrayBuffer())
      : await extractEpubSegments(file);
  for (let start = 0; ; start += MAX_SEGMENT_BATCH) {
    const batch = segments.slice(start, start + MAX_SEGMENT_BATCH);
    const done = start + MAX_SEGMENT_BATCH >= segments.length;
    await postBatch(bookId, batch, done);
    if (done) return;
  }
}
