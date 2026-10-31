import { requireUser } from '@/lib/auth/require-user';
import { THREAD_NOT_FOUND, getThread } from '@/lib/threads/service.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ threadId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { threadId } = await params;
    if (!UUID.test(threadId)) return THREAD_NOT_FOUND();
    return Response.json(await getThread(supabase, threadId));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
