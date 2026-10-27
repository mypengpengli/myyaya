import type { AppMode } from "./setup-storage";

/** Ignore obsolete setup results after a mode switch, new request or unmount. */
export function createReadinessRefresher<T extends { appMode: AppMode }>(options: {
  getMode(): AppMode;
  compute(): Promise<T>;
  commit(result: T): void;
  setLoading(loading: boolean): void;
}) {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    async refresh(): Promise<T | null> {
      const request = ++generation;
      const mode = options.getMode();
      const isCurrent = () => request === generation && mode === options.getMode();
      options.setLoading(true);
      try {
        const result = await options.compute();
        if (!isCurrent() || result.appMode !== mode) return null;
        options.commit(result);
        return result;
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      } finally {
        if (isCurrent()) options.setLoading(false);
      }
    },
  };
}
