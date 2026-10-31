import { lastMockPrompt } from '@/lib/ai/registry.server';

export async function GET() {
  if (process.env.AI_MOCK !== '1') return new Response(null, { status: 404 });
  return Response.json({ prompt: lastMockPrompt() });
}
