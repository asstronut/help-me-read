import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createProviderRegistry, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { TestControls } from '@/lib/test-controls.server';
import { MODELS } from './models';

const MOCK_CHUNKS = ['MOCK ', 'ANS', 'WER'];
const MOCK_USAGE = { inputTokens: 100, outputTokens: 50 };

// Route modules can be bundled separately in dev, so the recorded prompt lives on globalThis.
const LAST_PROMPT = Symbol.for('help-me-read.mock.lastPrompt');
type PromptStore = { [LAST_PROMPT]?: string };

export function lastMockPrompt(): string | null {
  return (globalThis as PromptStore)[LAST_PROMPT] ?? null;
}

type MockPrompt = Parameters<MockLanguageModelV4['doStream']>[0]['prompt'];

function promptAsText(prompt: MockPrompt): string {
  return prompt
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    )
    .join('\n\n');
}

function mockModel(modelId: string, controls: TestControls): LanguageModel {
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId,
    doStream: async ({ prompt }) => {
      (globalThis as PromptStore)[LAST_PROMPT] = promptAsText(prompt);
      const chunks =
        controls.failAfter === null ? MOCK_CHUNKS : MOCK_CHUNKS.slice(0, controls.failAfter);
      const failed = controls.failAfter !== null && controls.failAfter < MOCK_CHUNKS.length;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            for (const delta of chunks) controller.enqueue({ type: 'text-delta', id: 't', delta });
            if (failed) {
              controller.enqueue({ type: 'error', error: new Error('Mock provider failure') });
              controller.close();
              return;
            }
            controller.enqueue({ type: 'text-end', id: 't' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: {
                  total: MOCK_USAGE.inputTokens,
                  noCache: MOCK_USAGE.inputTokens,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: MOCK_USAGE.outputTokens,
                  text: MOCK_USAGE.outputTokens,
                  reasoning: undefined,
                },
              },
            });
            controller.close();
          },
        }),
      };
    },
  });
}

let registry: ReturnType<typeof createRegistry> | undefined;

function createRegistry() {
  return createProviderRegistry({
    google: createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY }),
    anthropic: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    openai: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    openrouter: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY }),
  });
}

/** The language model for a registry id; with AI_MOCK=1, the mock model that honours the test controls. */
export function getLanguageModel(modelId: string, controls: TestControls): LanguageModel {
  if (process.env.AI_MOCK === '1') return mockModel(modelId, controls);
  const info = MODELS.find((m) => m.id === modelId);
  if (!info) throw new Error(`Unknown model ${modelId}`);
  registry ??= createRegistry();
  return registry.languageModel(`${info.provider}:${info.id}`);
}
