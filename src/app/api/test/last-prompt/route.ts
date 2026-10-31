import { requireUser } from '@/lib/auth/require-user';
import { lastMockPrompt } from '@/lib/ai/registry.server';
import { aiMockEnabled } from '@/lib/test-mode';

export async function GET() {
  if (!aiMockEnabled()) return new Response(null, { status: 404 });
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  return Response.json({ prompt: lastMockPrompt() });
}
