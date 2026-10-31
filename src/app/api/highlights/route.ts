import { requireUser } from '@/lib/auth/require-user';
import {
  CreateHighlightSchema,
  createNoteHighlight,
  listHighlights,
} from '@/lib/highlights/service.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  try {
    const { supabase } = await requireUser();
    const bookId = new URL(req.url).searchParams.get('bookId');
    if (!bookId || !UUID.test(bookId)) {
      return Response.json({ message: 'Book not found' }, { status: 404 });
    }
    return Response.json({ highlights: await listHighlights(supabase, bookId) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    const { supabase } = await requireUser();
    const parsed = CreateHighlightSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ message: 'Invalid highlight' }, { status: 400 });
    return Response.json(await createNoteHighlight(supabase, parsed.data), { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
