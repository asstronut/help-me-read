import { expect, test } from 'vitest';
import { apiClient } from '../helpers/api-client';

test('GET /api/health reports ok', async () => {
  const res = await apiClient().get('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
