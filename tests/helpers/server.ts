import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | undefined;

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/health`); // any HTTP response means the server is up
      return;
    } catch {
      // server not accepting connections yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server did not become healthy at ${BASE}/api/health`);
}

export async function setup(): Promise<void> {
  const status = spawnSync('npx supabase status', {
    encoding: 'utf8',
    shell: true,
  });
  if (status.status !== 0) {
    throw new Error(
      'Local Supabase is not running. Start it with `npx supabase start`.\n' +
        (status.stderr ?? ''),
    );
  }

  server = spawn(`npx next dev -p ${PORT}`, {
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, AI_MOCK: '1', NEXT_PUBLIC_E2E: '1' },
  });
  await waitForHealth(120_000);
}

export async function teardown(): Promise<void> {
  if (!server?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  } else {
    server.kill('SIGTERM');
  }
}
