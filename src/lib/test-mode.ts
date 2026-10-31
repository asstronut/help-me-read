type Env = Record<string, string | undefined>;

/**
 * Whether the mock AI and its test controls are on. Production builds ignore `AI_MOCK`,
 * so a stray env var on the host can never swap in the fake model or expose test routes.
 */
export function aiMockEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.AI_MOCK === '1';
}

/** Whether browser-test hooks (the test page, the selection debug global) are on; never in production. */
export function e2eHooksEnabled(): boolean {
  // Literal `process.env.X` reads so Next inlines both values into client bundles.
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_E2E === '1';
}
