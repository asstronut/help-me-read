import { requireUser } from '@/lib/auth/require-user';
import { deleteVocab } from '@/lib/vocab/service.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ entryId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { entryId } = await params;
    if (!UUID.test(entryId)) return Response.json({ message: 'Entry not found' }, { status: 404 });
    await deleteVocab(supabase, entryId);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
