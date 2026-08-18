// Serializes mutations inside one tab. Two tabs (or two devices) still race, but
// that race is resolved by the store's SHA check + retry; this mutex just stops a
// burst of clicks in *this* tab from all reading the same base revision and
// forcing four rounds of retries.
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    // Swallow rejection on the chain itself so one failed op doesn't reject the
    // next waiter; the original promise still rejects for the caller.
    this.tail = run.catch(() => undefined);
    return run;
  }
}
