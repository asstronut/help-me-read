import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import type { ReadingLocation } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ bookId: string }> };

const notFound = () => Response.json({ message: 'Book not found' }, { status: 404 });

const LocationSchema = z.union([
  z.strictObject({ page: z.number().int().min(1) }),
  z.strictObject({ cfi: z.string().min(1) }),
]);

/** A location, optionally with how far through the book it is (0 to 1), which the Library shows. */
function parseBody(raw: unknown): { location: ReadingLocation; progress: number | undefined } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { progress, ...rest } = raw as Record<string, unknown>;
  const location = LocationSchema.safeParse(rest);
  const fraction = z.number().min(0).max(1).optional().safeParse(progress);
  if (!location.success || !fraction.success) return null;
  return { location: location.data, progress: fraction.data };
}

export async function GET(_req: Request, { params }: Ctx) {
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

    const { data: row, error } = await supabase
      .from('reading_positions')
      .select('location')
      .eq('book_id', bookId)
      .maybeSingle();
    if (error) throw error;
    return Response.json({ location: (row?.location as ReadingLocation | undefined) ?? null });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function PUT(req: Request, { params }: Ctx) {
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

    const parsed = parseBody(await req.json().catch(() => null));
    if (!parsed) return Response.json({ message: 'Invalid location' }, { status: 400 });

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('reading_positions')
      .upsert({ book_id: bookId, location: parsed.location, updated_at: now });
    if (error) throw error;
    const { error: openedError } = await supabase
      .from('books')
      .update({ last_opened_at: now, progress: parsed.progress }) // an undefined progress is left out
      .eq('id', bookId);
    if (openedError) throw openedError;
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
