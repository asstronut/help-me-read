import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { MAX_TITLE_CHARS } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ bookId: string }> };

const notFound = () => Response.json({ message: 'Book not found' }, { status: 404 });

const BodySchema = z.object({
  title: z
    .string()
    .trim()
    .refine((t) => t.length > 0 && [...t].length <= MAX_TITLE_CHARS),
});

/** Renames the Book. The title is trimmed; an empty or overlong one is refused, not cut. */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { bookId } = await params;
    if (!UUID.test(bookId)) return notFound();
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { message: `Title must be 1 to ${MAX_TITLE_CHARS} characters` },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('books')
      .update({ title: parsed.data.title })
      .eq('id', bookId)
      .select('title')
      .maybeSingle();
    if (error) throw error;
    if (!data) return notFound();
    return Response.json({ title: data.title });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
