import { requireUser } from '@/lib/auth/require-user';
import { CreateThreadSchema, createThread } from '@/lib/threads/service.server';

export async function POST(req: Request) {
  try {
    const { supabase } = await requireUser();
    const parsed = CreateThreadSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ message: 'Invalid thread' }, { status: 400 });
    const created = await createThread(supabase, parsed.data);
    return Response.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
