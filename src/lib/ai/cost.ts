import { z } from 'zod';
import { estimateTokens } from '@/lib/types';
import type { ModelInfo } from './models';

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** Cost in micro-dollars (USD × 1e6). Prices are per million tokens, so tokens × price is already micro-dollars. */
function costMicroUsd(model: ModelInfo, usage: TokenUsage): number {
  return usage.inputTokens * model.inputUsdPerMTok + usage.outputTokens * model.outputUsdPerMTok;
}

/** The provider's reported cost when it gives one (OpenRouter), else the registry prices. */
export function callCostUsd(
  model: ModelInfo,
  usage: TokenUsage,
  reportedCostUsd: number | undefined,
): number {
  return reportedCostUsd ?? costMicroUsd(model, usage) / 1e6;
}

/** Estimated input cost of a prompt, in micro-dollars: chars ÷ 4 tokens at the input price. */
export function estimateInputMicroUsd(model: ModelInfo, promptChars: number): number {
  return costMicroUsd(model, { inputTokens: estimateTokens(promptChars), outputTokens: 0 });
}

/** Asks OpenRouter to report each call's actual cost; other providers need nothing. */
export function costReportingOptions(model: ModelInfo) {
  return model.provider === 'openrouter' ? { openrouter: { usage: { include: true } } } : undefined;
}

const OpenRouterCostSchema = z.object({
  openrouter: z.object({ usage: z.object({ cost: z.number() }) }),
});

/** The cost OpenRouter reported in a call's provider metadata, if any. */
export function reportedCostUsdOf(providerMetadata: unknown): number | undefined {
  const reported = OpenRouterCostSchema.safeParse(providerMetadata);
  return reported.success ? reported.data.openrouter.usage.cost : undefined;
}
