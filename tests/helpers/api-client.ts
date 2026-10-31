export const BASE_URL = 'http://localhost:3100';

type Body = unknown;

export function apiClient() {
  const jar = new Map<string, string>();

  function storeCookies(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
  }

  async function request(
    method: string,
    path: string,
    body?: Body,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const h: Record<string, string> = { ...headers };
    if (jar.size > 0) {
      h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] ??= 'application/json';
    }
    const res = await fetch(BASE_URL + path, {
      method,
      headers: h,
      body: payload,
      redirect: 'manual',
    });
    storeCookies(res);
    return res;
  }

  return {
    get: (path: string, headers?: Record<string, string>) =>
      request('GET', path, undefined, headers),
    post: (path: string, body?: Body, headers?: Record<string, string>) =>
      request('POST', path, body, headers),
    put: (path: string, body?: Body, headers?: Record<string, string>) =>
      request('PUT', path, body, headers),
    patch: (path: string, body?: Body, headers?: Record<string, string>) =>
      request('PATCH', path, body, headers),
    del: (path: string, headers?: Record<string, string>) =>
      request('DELETE', path, undefined, headers),
    login: (email: string, password: string) =>
      request('POST', '/api/auth/login', { email, password }),
    async streamText(
      path: string,
      body: Body,
      headers?: Record<string, string>,
    ): Promise<string> {
      const res = await request('POST', path, body, headers);
      return await res.text();
    },
  };
}
