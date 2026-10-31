import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { availableModels } from '@/lib/ai/models';
import type { Database } from '@/lib/supabase/database.types';
import { ACTIONS, DEFAULT_MONTHLY_CAP_USD, THEMES, type Action, type Theme } from '@/lib/types';

type Db = SupabaseClient<Database>;
type Row = Database['public']['Tables']['settings']['Row'];

export type Settings = {
  explanationLanguage: string;
  actionModels: Partial<Record<Action, string>>;
  monthlyCapUsd: number;
  theme: Theme;
};

export const DEFAULT_SETTINGS: Settings = {
  explanationLanguage: 'English',
  actionModels: {},
  monthlyCapUsd: DEFAULT_MONTHLY_CAP_USD,
  theme: 'light',
};

const ActionModelsSchema = z.partialRecord(z.enum(ACTIONS), z.string());
const SettingsSchema = z.object({
  explanationLanguage: z.string().trim().min(1).max(40),
  actionModels: ActionModelsSchema,
  monthlyCapUsd: z.number().min(0).max(1000),
  theme: z.enum(THEMES),
});

/** The valid settings, or null when a field is out of range or a chosen model is not available. */
export function validateSettings(input: unknown): Settings | null {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return null;
  const available = availableModels(process.env);
  const allAvailable = Object.values(parsed.data.actionModels).every((id) =>
    available.some((m) => m.id === id),
  );
  return allAvailable ? parsed.data : null;
}

function fromRow(row: Row): Settings {
  const models = ActionModelsSchema.safeParse(row.action_models);
  return {
    explanationLanguage: row.explanation_language,
    actionModels: models.success ? models.data : {},
    monthlyCapUsd: Number(row.monthly_cap_usd),
    theme: THEMES.find((t) => t === row.theme) ?? DEFAULT_SETTINGS.theme,
  };
}

async function readRow(supabase: Db): Promise<Row | null> {
  const { data, error } = await supabase.from('settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/** The signed-in user's settings; the defaults are saved on the first read. */
export async function getSettings(supabase: Db): Promise<Settings> {
  const existing = await readRow(supabase);
  if (existing) return fromRow(existing);
  const { error } = await supabase
    .from('settings')
    .upsert({}, { onConflict: 'owner_id', ignoreDuplicates: true });
  if (error) throw error;
  const created = await readRow(supabase);
  return created ? fromRow(created) : DEFAULT_SETTINGS;
}

export async function saveSettings(supabase: Db, userId: string, settings: Settings): Promise<void> {
  const { error } = await supabase.from('settings').upsert({
    owner_id: userId,
    explanation_language: settings.explanationLanguage,
    action_models: settings.actionModels,
    monthly_cap_usd: settings.monthlyCapUsd,
    theme: settings.theme,
  });
  if (error) throw error;
}

/** The theme to render pages with; light without a session (the login page). */
export async function currentTheme(supabase: Db): Promise<Theme> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return DEFAULT_SETTINGS.theme;
  try {
    return (await getSettings(supabase)).theme;
  } catch {
    return DEFAULT_SETTINGS.theme;
  }
}
