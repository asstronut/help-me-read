import { isAllowedEmail } from '@/lib/auth/allowed-email';
import { createClient } from '@/lib/supabase/server';

type LoginBody = { email?: unknown; password?: unknown; magicLink?: unknown };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as LoginBody;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isAllowedEmail(email)) {
    return Response.json({ message: 'This app is private' }, { status: 403 });
  }

  const supabase = await createClient();

  if (body.magicLink === true) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL('/auth/callback', req.url).toString(),
      },
    });
    if (error) return Response.json({ message: error.message }, { status: 400 });
    return Response.json({ message: 'Check your email for the sign-in link' });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return Response.json({ message: 'Invalid email or password' }, { status: 401 });
  return Response.json({ ok: true });
}
