import { z } from 'zod';
import { HIGHLIGHT_COLORS, type Anchor } from '@/lib/types';

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export const AnchorSchema: z.ZodType<Anchor> = z.discriminatedUnion('format', [
  z.object({ format: z.literal('pdf'), page: z.number().int().min(1), rects: z.array(RectSchema) }),
  z.object({ format: z.literal('epub'), cfi: z.string().min(1) }),
]);
/** A `ReaderSelection` as a request carries it. */
export const SelectionSchema = z.object({
  bookId: z.uuid(),
  segmentSeq: z.number().int().min(0),
  text: z.string().refine((t) => t.trim() !== ''),
  prefix: z.string(),
  anchor: AnchorSchema,
});
export const HighlightColorSchema = z.enum(HIGHLIGHT_COLORS);
