import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { getSettings } from '@/lib/settings/settings.server';
import { estimateInputMicroUsd } from './cost';
import type { ModelInfo } from './models';

type Db = SupabaseClient<Database>;

// Costs are stored with six decimals, so sums are exact in whole micro-dollars.
const toMicro = (usd: number | string) => Math.round(Number(usd) * 1e6);

function utcMonth(now: Date): { start: string; end: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

// Summed in the database: selecting the rows would be cut off at the API's max_rows, with no error.
async function monthSpendMicroUsd(supabase: Db, now: Date): Promise<number> {
  const { start, end } = utcMonth(now);
  const { data, error } = await supabase.rpc('month_spend', { period_start: start, period_end: end });
  if (error) throw error;
  return toMicro(data);
}

export async function getSpend(
  supabase: Db,
  now: Date,
): Promise<{ monthSpendUsd: number; capUsd: number }> {
  const spend = await monthSpendMicroUsd(supabase, now);
  return { monthSpendUsd: spend / 1e6, capUsd: (await getSettings(supabase)).monthlyCapUsd };
}

/** Throws a 402 Response when this month's spend plus the prompt's estimated input cost is above the cap. */
export async function assertWithinCap(
  supabase: Db,
  model: ModelInfo,
  promptChars: number,
  now: Date,
): Promise<void> {
  const spend = await monthSpendMicroUsd(supabase, now);
  const cap = (await getSettings(supabase)).monthlyCapUsd;
  if (spend + estimateInputMicroUsd(model, promptChars) > toMicro(cap)) {
    const message = `You've reached this month's AI limit of $${cap.toFixed(2)}. Raise it in Settings.`;
    throw Response.json({ message }, { status: 402 });
  }
}
