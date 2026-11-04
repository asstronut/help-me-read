import { requireUser } from '@/lib/auth/require-user';
import {
  HIGHLIGHT_NOT_FOUND,
  UpdateHighlightSchema,
  deleteHighlight,
  updateHighlight,
} from '@/lib/highlights/service.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ highlightId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { highlightId } = await params;
    if (!UUID.test(highlightId)) return HIGHLIGHT_NOT_FOUND();
    const parsed = UpdateHighlightSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ message: 'Invalid highlight' }, { status: 400 });
    return Response.json(await updateHighlight(supabase, highlightId, parsed.data));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { highlightId } = await params;
    if (!UUID.test(highlightId)) return HIGHLIGHT_NOT_FOUND();
    await deleteHighlight(supabase, highlightId);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
