import { MODELS, isProviderAvailable } from '@/lib/ai/models';
import { requireUser } from '@/lib/auth/require-user';

export async function GET() {
  try {
    await requireUser();
    const models = MODELS.map((m) => ({
      ...m,
      available: isProviderAvailable(m.provider, process.env),
    }));
    return Response.json({ models });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
