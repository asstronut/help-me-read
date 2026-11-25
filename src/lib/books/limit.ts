/**
 * Runs async tasks at most `n` at a time, in the order they were queued. The returned function
 * queues a task and settles like it, once it has had its turn and finished.
 */
export function limit(n: number) {
  let running = 0;
  const waiting: (() => void)[] = [];

  const next = () => {
    if (running >= n) return;
    const start = waiting.shift();
    if (!start) return;
    running += 1;
    start();
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        // A task that throws before returning its promise still frees its place.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            next();
          });
      });
      next();
    });
  };
}
