// useCockpit.ts - generic read-only fetch hook for the /api/* endpoints.
import { useEffect, useState } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Fetches `url` and re-fetches whenever `url` changes. `url=null` is a no-op
// (used to skip a fetch until a dependency is ready).
export function useFetch<T>(url: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: !!url, error: null });

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ data: null, loading: true, error: null });
    fetch(url, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error(`Server responded ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (alive) setState({ data: null, loading: false, error: (err as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return state;
}
