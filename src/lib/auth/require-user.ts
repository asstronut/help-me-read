import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createClient } from '@/lib/supabase/server';
import { isAllowedEmail } from './allowed-email';

/**
 * Returns the signed-in allowed user's client and id.
 * Throws a 401 Response without a session and a 403 Response for any other email.
 */
export async function requireUser(): Promise<{
  supabase: SupabaseClient<Database>;
  userId: string;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw Response.json({ message: 'Not signed in' }, { status: 401 });
  }
  if (!isAllowedEmail(data.user.email)) {
    throw Response.json({ message: 'This app is private' }, { status: 403 });
  }
  return { supabase, userId: data.user.id };
}
