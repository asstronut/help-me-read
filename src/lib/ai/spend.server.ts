import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { DEFAULT_MONTHLY_CAP_USD } from '@/lib/types';
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

async function monthSpendMicroUsd(supabase: Db, now: Date): Promise<number> {
  const { start, end } = utcMonth(now);
  const [messages, events] = await Promise.all([
    supabase.from('messages').select('cost_usd').gte('created_at', start).lt('created_at', end),
    supabase.from('usage_events').select('cost_usd').gte('created_at', start).lt('created_at', end),
  ]);
  if (messages.error) throw messages.error;
  if (events.error) throw events.error;
  return [...messages.data, ...events.data].reduce((sum, row) => sum + toMicro(row.cost_usd), 0);
}

// The cap moves to settings in Task 13.
const monthlyCapUsd = () => DEFAULT_MONTHLY_CAP_USD;

export async function getSpend(
  supabase: Db,
  now: Date,
): Promise<{ monthSpendUsd: number; capUsd: number }> {
  const spend = await monthSpendMicroUsd(supabase, now);
  return { monthSpendUsd: spend / 1e6, capUsd: monthlyCapUsd() };
}

/** Throws a 402 Response when this month's spend plus the prompt's estimated input cost is above the cap. */
export async function assertWithinCap(
  supabase: Db,
  model: ModelInfo,
  promptChars: number,
  now: Date,
): Promise<void> {
  const spend = await monthSpendMicroUsd(supabase, now);
  const cap = monthlyCapUsd();
  if (spend + estimateInputMicroUsd(model, promptChars) > toMicro(cap)) {
    const message = `You've reached this month's AI limit of $${cap.toFixed(2)}. Raise it in Settings.`;
    throw Response.json({ message }, { status: 402 });
  }
}
