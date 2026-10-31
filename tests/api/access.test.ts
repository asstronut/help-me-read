import { beforeAll, describe, expect, test } from 'vitest';
import { apiClient } from '../helpers/api-client';
import { INTRUDER, OWNER, ensureUser, sessionCookieHeader } from '../helpers/users';

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
});

describe('private access', () => {
  test('health needs no session', async () => {
    const res = await apiClient().get('/api/health');
    expect(res.status).toBe(200);
  });

  test('the allowed email can log in and read /api/me', async () => {
    const api = apiClient();
    const res = await api.login(OWNER.email, OWNER.password);
    expect(res.status).toBe(200);
    const me = await api.get('/api/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: OWNER.email });
  });

  test('the allowed email matches trimmed and case-insensitively', async () => {
    const api = apiClient();
    const res = await api.login(' OWNER@test.local ', OWNER.password);
    expect(res.status).toBe(200);
  });

  test('another email is refused and gets no session', async () => {
    const api = apiClient();
    const res = await api.login(INTRUDER.email, INTRUDER.password);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: 'This app is private' });
    expect((await api.get('/api/me')).status).toBe(401);
  });

  test('bad credentials are 401', async () => {
    const res = await apiClient().login(OWNER.email, 'wrong-password');
    expect(res.status).toBe(401);
  });

  test('a magic link is refused for another email', async () => {
    const res = await apiClient().post('/api/auth/login', {
      email: INTRUDER.email,
      magicLink: true,
    });
    expect(res.status).toBe(403);
  });

  test('without a session /api/me is 401', async () => {
    expect((await apiClient().get('/api/me')).status).toBe(401);
  });

  test('logout ends the session', async () => {
    const api = apiClient();
    await api.login(OWNER.email, OWNER.password);
    expect((await api.get('/api/me')).status).toBe(200);
    expect((await api.post('/api/auth/logout')).status).toBe(200);
    expect((await api.get('/api/me')).status).toBe(401);
  });

  test('a real session for another email is refused by the API and the proxy', async () => {
    const cookie = await sessionCookieHeader(INTRUDER.email, INTRUDER.password);
    const api = apiClient();
    const me = await api.get('/api/me', { cookie });
    expect(me.status).toBe(403);
    const page = await api.get('/library', { cookie });
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get('location')!, 'http://localhost').pathname).toBe('/login');
  });

  test.each(['/authors', '/login-history', '/apiary'])(
    'page %s without a session redirects to /login',
    async (path) => {
      const res = await apiClient().get(path);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get('location')!, 'http://localhost').pathname).toBe('/login');
    },
  );
});
