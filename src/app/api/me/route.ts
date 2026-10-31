import { requireUser } from '@/lib/auth/require-user';

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data } = await supabase.auth.getUser();
    return Response.json({ email: data.user?.email });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
