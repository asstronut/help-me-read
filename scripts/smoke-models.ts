// Real-provider check: runs Define and Explain through every model whose API key is set.
// Usage: npx tsx scripts/smoke-models.ts   (keys come from the environment or .env.local)
import { generateText } from 'ai';
import { callCostUsd, costReportingOptions, reportedCostUsdOf } from '@/lib/ai/cost';
import { MODELS, PROVIDER_ENV_KEYS } from '@/lib/ai/models';
import { buildFirstUserMessage, buildSystemPrompt } from '@/lib/ai/prompts';
import { getLanguageModel } from '@/lib/ai/registry.server';
import type { Action } from '@/lib/types';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: use the environment as it is.
}
// This script must reach the real providers, never the mock.
delete process.env.AI_MOCK;

const LANGUAGE = 'English';
const META = { title: 'Smoke test', author: null, segmentLabel: 'page 1' };

const CASES: { action: Action; context: string; selection: string }[] = [
  {
    action: 'define',
    context: 'She sat on the ⟦bank⟧ of the river.',
    selection: 'bank',
  },
  {
    action: 'explain',
    context:
      'The committee delayed the vote. ⟦Nobody had read the report, yet everyone claimed to have an opinion. The chair adjourned, pleased that nothing had been decided.⟧',
    selection:
      'Nobody had read the report, yet everyone claimed to have an opinion. The chair adjourned, pleased that nothing had been decided.',
  },
];

const models = MODELS.filter((m) => process.env[PROVIDER_ENV_KEYS[m.provider]]?.trim());
if (models.length === 0) {
  const names = Object.values(PROVIDER_ENV_KEYS).join(', ');
  console.log(`No providers are configured. Set at least one of: ${names}.`);
  process.exit(0);
}

let totalUsd = 0;
let failures = 0;
for (const model of models) {
  for (const { action, context, selection } of CASES) {
    const started = Date.now();
    try {
      const result = await generateText({
        model: getLanguageModel(model.id, { now: new Date(), failAfter: null }),
        instructions: buildSystemPrompt(action, LANGUAGE),
        prompt: buildFirstUserMessage({ action, selection: { text: selection }, context, meta: META }),
        providerOptions: costReportingOptions(model),
      });
      const usage = {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
      const cost = callCostUsd(model, usage, reportedCostUsdOf(result.providerMetadata));
      totalUsd += cost;
      console.log(
        `\n=== ${model.id} / ${action}: ${Date.now() - started} ms, $${cost.toFixed(6)} ` +
          `(${usage.inputTokens} in, ${usage.outputTokens} out)\n${result.text.trim()}`,
      );
    } catch (e) {
      failures += 1;
      console.log(`\n=== ${model.id} / ${action}: FAILED\n${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

console.log(`\nTotal cost: $${totalUsd.toFixed(6)}; ${failures} failed call(s).`);
process.exit(failures > 0 ? 1 : 0);
