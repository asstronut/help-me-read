import { requireUser } from '@/lib/auth/require-user';
import { testControls } from '@/lib/test-controls.server';
import { ChatSchema, THREAD_NOT_FOUND, streamAnswer } from '@/lib/threads/service.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ threadId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { threadId } = await params;
    if (!UUID.test(threadId)) return THREAD_NOT_FOUND();
    const parsed = ChatSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ message: 'Invalid message' }, { status: 400 });
    return await streamAnswer(supabase, threadId, parsed.data, testControls(req));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
