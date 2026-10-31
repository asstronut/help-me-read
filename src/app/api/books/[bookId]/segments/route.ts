import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { MAX_SEGMENT_BATCH, type Segment } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ bookId: string }> };

const notFound = () => Response.json({ message: 'Book not found' }, { status: 404 });
const badRequest = (message: string) => Response.json({ message }, { status: 400 });

const SegmentSchema = z.object({
  seq: z.number().int().min(0),
  label: z.string(),
  paragraphs: z.array(z.string()),
});
const BodySchema = z.object({
  segments: z.array(SegmentSchema).max(MAX_SEGMENT_BATCH),
  done: z.boolean(),
});

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { bookId } = await params;
    if (!UUID.test(bookId)) return notFound();

    const { data: book, error: bookError } = await supabase
      .from('books')
      .select('id')
      .eq('id', bookId)
      .maybeSingle();
    if (bookError) throw bookError;
    if (!book) return notFound();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest('Invalid segments');
    const { segments, done } = parsed.data;

    if (segments.length > 0) {
      const { error } = await supabase.from('segments').upsert(
        segments.map((s) => ({ ...s, book_id: bookId })),
        { onConflict: 'book_id,seq' },
      );
      if (error) throw error;
    }

    if (done) {
      const { data: last, error: lastError } = await supabase
        .from('segments')
        .select('seq')
        .eq('book_id', bookId)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throw lastError;
      const { error } = await supabase
        .from('books')
        .update({ segment_count: last ? last.seq + 1 : 0, extracted_at: new Date().toISOString() })
        .eq('id', bookId);
      if (error) throw error;
    }
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { bookId } = await params;
    if (!UUID.test(bookId)) return notFound();

    const raw = new URL(req.url).searchParams.get('seq');
    const seq = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    if (seq === null) return badRequest('seq must be a non-negative integer');

    const { data, error } = await supabase
      .from('segments')
      .select('seq, label, paragraphs')
      .eq('book_id', bookId)
      .eq('seq', seq)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ message: 'Segment not found' }, { status: 404 });
    const segment: Segment = data;
    return Response.json(segment);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
