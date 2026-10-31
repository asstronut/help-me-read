import { requireUser } from '@/lib/auth/require-user';
import { testControls } from '@/lib/test-controls.server';
import { SaveVocabSchema, listVocab, saveVocab } from '@/lib/vocab/service.server';

export async function GET(req: Request) {
  try {
    const { supabase } = await requireUser();
    const q = new URL(req.url).searchParams.get('q') ?? '';
    return Response.json({ entries: await listVocab(supabase, q) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    const { supabase } = await requireUser();
    const parsed = SaveVocabSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ message: 'Invalid vocab entry' }, { status: 400 });
    const entry = await saveVocab(supabase, parsed.data, testControls(req));
    return Response.json({ entry }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
