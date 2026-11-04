import { chromium, type FullConfig } from '@playwright/test';
import { OWNER, ensureUser } from '../helpers/users';

export const OWNER_STATE = 'tests/e2e/.auth/owner.json';

export default async function globalSetup(config: FullConfig): Promise<void> {
  await ensureUser(OWNER.email, OWNER.password);
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  const res = await page.request.post('/api/auth/login', {
    data: { email: OWNER.email, password: OWNER.password },
  });
  if (!res.ok()) throw new Error(`Owner login failed: ${res.status()}`);
  await page.context().storageState({ path: OWNER_STATE });
  await browser.close();
}
