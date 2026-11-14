import { expect } from 'vitest';
import { DEFAULT_SETTINGS } from './default-settings';
import type { Api } from './threads';

/** Saves the defaults with `change` laid over them; the settings API takes the whole object. */
export const putSettings = (api: Api, change: object = {}) =>
  api.put('/api/settings', { ...DEFAULT_SETTINGS, ...change });

/** Settings belong to the shared owner, so every test that changes them hands the defaults back. */
export async function restoreSettings(api: Api): Promise<void> {
  expect((await putSettings(api)).status).toBe(200);
}
