import { expect, test } from 'vitest';
import { limit } from '../../src/lib/books/limit';

/** A task that finishes only when told to, and records when it started. */
function gate(started: string[], name: string) {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return {
    task: () => {
      started.push(name);
      return done.then(() => name);
    },
    finish: () => open(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('runs two at a time, starting the next as soon as one finishes, in queued order', async () => {
  const run = limit(2);
  const started: string[] = [];
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => gate(started, name));
  const results = [a, b, c, d].map((g) => run(g.task));

  await settle();
  expect(started).toEqual(['a', 'b']);

  b.finish();
  await settle();
  expect(started).toEqual(['a', 'b', 'c']);

  a.finish();
  c.finish();
  d.finish();
  expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd']);
});

test('a task that fails frees its place for the next one', async () => {
  const run = limit(1);
  const failed = run(() => Promise.reject(new Error('no')));
  const thrown = run(() => {
    throw new Error('sync');
  });
  const after = run(async () => 'ran');
  await expect(failed).rejects.toThrow('no');
  await expect(thrown).rejects.toThrow('sync');
  expect(await after).toBe('ran');
});
