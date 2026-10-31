import { aiMockEnabled } from '@/lib/test-mode';
import type { Action } from '@/lib/types';

export type Provider = 'google' | 'anthropic' | 'openai' | 'openrouter';

export type ModelInfo = {
  id: string;
  provider: Provider;
  label: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  tested: boolean;
};

export const PROVIDER_ENV_KEYS: Record<Provider, string> = {
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

// Standard-tier prices per million tokens, copied from the providers' pricing pages on 2026-10-31.
// OpenRouter prices are the cheapest listed endpoint; OpenRouter reports the actual cost per call.
export const MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.8-flash',
    provider: 'google',
    label: 'Gemini 3.8 Flash',
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 3.75,
    tested: true,
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'google',
    label: 'Gemini 3.1 Pro',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 12,
    tested: false,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    tested: true,
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    tested: true,
  },
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    tested: false,
  },
  {
    id: 'gpt-6.1-sol',
    provider: 'openai',
    label: 'GPT-6.1 Sol',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    tested: false,
  },
  {
    id: 'meta-llama/llama-4-maverick',
    provider: 'openrouter',
    label: 'Llama 4 Maverick',
    inputUsdPerMTok: 0.1875,
    outputUsdPerMTok: 0.6525,
    tested: false,
  },
  {
    id: 'mistralai/mistral-medium-3.1',
    provider: 'openrouter',
    label: 'Mistral Medium 3.1',
    inputUsdPerMTok: 0.4,
    outputUsdPerMTok: 2,
    tested: false,
  },
  {
    id: 'deepseek/deepseek-chat-v3.1',
    provider: 'openrouter',
    label: 'DeepSeek V3.1',
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 0.95,
    tested: false,
  },
];

export const DEFAULT_ACTION_MODELS: Record<Action, string> = {
  translate: 'gemini-3.8-flash',
  define: 'gemini-3.8-flash',
  explain: 'claude-sonnet-5-5',
  simplify: 'claude-sonnet-5-5',
  ask: 'claude-sonnet-5-5',
};

type Env = Record<string, string | undefined>;

export function isProviderAvailable(provider: Provider, env: Env): boolean {
  return aiMockEnabled(env) || Boolean(env[PROVIDER_ENV_KEYS[provider]]?.trim());
}

export function availableModels(env: Env): ModelInfo[] {
  return MODELS.filter((m) => isProviderAvailable(m.provider, env));
}

const NO_PROVIDER = () =>
  Response.json({ message: 'No AI provider is configured.' }, { status: 503 });

/** The settings model if available, else the shipped default if available, else the first available. Throws a 503 Response when none is. */
export function resolveModel(
  action: Action,
  settingsModels: Partial<Record<Action, string>>,
  available: ModelInfo[],
): ModelInfo {
  const find = (id: string | undefined) => available.find((m) => m.id === id);
  const model = find(settingsModels[action]) ?? find(DEFAULT_ACTION_MODELS[action]) ?? available[0];
  if (!model) throw NO_PROVIDER();
  return model;
}
