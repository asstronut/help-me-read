import { NextResponse } from 'next/server';
import { isAllowedEmail } from '@/lib/auth/allowed-email';
import { createClient } from '@/lib/supabase/server';

// Completes the magic-link sign-in: exchanges the code for a session cookie.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && isAllowedEmail(data.user?.email)) {
      return NextResponse.redirect(new URL('/library', url));
    }
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL('/login', url));
}
