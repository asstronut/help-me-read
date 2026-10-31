import { getSpend } from '@/lib/ai/spend.server';
import { requireUser } from '@/lib/auth/require-user';
import { getSettings, saveSettings, validateSettings } from '@/lib/settings/settings.server';
import { testControls } from '@/lib/test-controls.server';

export async function GET(req: Request) {
  try {
    const { supabase } = await requireUser();
    const settings = await getSettings(supabase);
    const { monthSpendUsd } = await getSpend(supabase, testControls(req).now);
    return Response.json({ settings, monthSpendUsd });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function PUT(req: Request) {
  try {
    const { supabase, userId } = await requireUser();
    const result = validateSettings(await req.json().catch(() => null));
    if ('error' in result) return Response.json({ message: result.error }, { status: 400 });
    await saveSettings(supabase, userId, result.settings);
    return Response.json({ settings: result.settings });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
