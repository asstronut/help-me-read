import { MAX_UPLOAD_BYTES, type BookFormat } from '@/lib/types';

export type UploadCheck = { ok: true; format: BookFormat } | { ok: false; reason: string };

export const UPLOAD_REASONS = {
  unsupported: 'Only PDF and EPUB files are supported.',
  tooLarge: 'This file is larger than 50 MB, the current limit.',
  empty: 'This file is empty.',
  notReal: "This file doesn't look like a real PDF or EPUB.",
} as const;

export function formatFromName(name: string): BookFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  return null;
}

/** Checks name and size only; follow with sniffFormat on the first bytes. */
export function validateUpload(file: { name: string; size: number }): UploadCheck {
  const format = formatFromName(file.name);
  if (!format) return { ok: false, reason: UPLOAD_REASONS.unsupported };
  if (file.size === 0) return { ok: false, reason: UPLOAD_REASONS.empty };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: UPLOAD_REASONS.tooLarge };
  return { ok: true, format };
}

/** `%PDF-` is a PDF; `PK\x03\x04` (a zip) is an EPUB. */
export function sniffFormat(head: Uint8Array): BookFormat | null {
  const startsWith = (bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return 'epub';
  return null;
}
