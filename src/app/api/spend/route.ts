import { getSpend } from '@/lib/ai/spend.server';
import { requireUser } from '@/lib/auth/require-user';
import { testControls } from '@/lib/test-controls.server';

export async function GET(req: Request) {
  try {
    const { supabase } = await requireUser();
    return Response.json(await getSpend(supabase, testControls(req).now));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
