import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedEmail } from '@/lib/auth/allowed-email';
import type { Database } from '@/lib/supabase/database.types';

// Page requests without an allowed session go to /login. API routes check the
// session themselves (requireUser) and answer 401/403.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  if (!isAllowedEmail(data.user?.email)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
