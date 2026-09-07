export class Metrics {
  private values = new Map<
    string,
    { count: number; totalMs: number; maxMs: number }
  >();
  async measure<T>(name: string, task: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await task();
    } finally {
      const ms = performance.now() - start,
        value = this.values.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
      value.count++;
      value.totalMs += ms;
      value.maxMs = Math.max(value.maxMs, ms);
      this.values.set(name, value);
    }
  }
  snapshot(): Record<
    string,
    { count: number; totalMs: number; maxMs: number; meanMs: number }
  > {
    return Object.fromEntries(
      [...this.values].map(([key, value]) => [
        key,
        { ...value, meanMs: value.totalMs / value.count },
      ]),
    );
  }
}
