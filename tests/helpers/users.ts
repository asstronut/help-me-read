import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile('.env.local');
} catch {
  // env may already be provided by the shell
}

export const OWNER = { email: 'owner@test.local', password: 'owner-password-1' };
export const INTRUDER = { email: 'intruder@test.local', password: 'intruder-password-1' };

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars are missing from .env.local');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Creates the user (or resets its password) with the admin API, which works with sign-ups off. */
export async function ensureUser(email: string, password: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error) return;
  const { data, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  const existing = data.users.find((u) => u.email === email);
  if (!existing) throw error;
  const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password });
  if (updateError) throw updateError;
}

export async function userId(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`No user ${email}`);
  return user.id;
}

/** Signs in directly with Supabase (bypassing the app's login) and returns the Cookie header the app would read. */
export async function sessionCookieHeader(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
