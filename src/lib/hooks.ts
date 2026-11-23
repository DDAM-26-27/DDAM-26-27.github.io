import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from './api';

/** Small data-loading hook: { data, error, loading, reload }. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiFailure ? e : new ApiFailure(0, 'ERROR', (e as Error).message));
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · DDAM Exam Booking` : 'DDAM Exam Booking';
  }, [title]);
}
