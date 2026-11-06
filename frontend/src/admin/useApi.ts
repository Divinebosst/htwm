"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";

/**
 * Loads data from the staff API and reloads it on demand.
 *
 *   const { data, error, loading, reload } = useApi<AdminEvent[]>("/admin/events?when=upcoming");
 *
 * Pass null to skip loading (e.g. when the user lacks permission).
 */
export function useApi<T>(path: string | null) {
  const [nonce, setNonce] = useState(0);
  const key = path ? `${path}#${nonce}` : null;
  const [result, setResult] = useState<{ key: string | null; data?: T; error?: ApiError }>({ key: null });

  useEffect(() => {
    if (!path || !key) return;
    const ctrl = new AbortController();
    api<T>(path, { signal: ctrl.signal }).then(
      (data) => setResult({ key, data }),
      (error) => {
        if (ctrl.signal.aborted) return;
        setResult((prev) => ({ key, data: prev.data, error: error as ApiError }));
      },
    );
    return () => ctrl.abort();
  }, [path, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data: result.data,
    error: result.key === key ? result.error : undefined,
    loading: !!key && result.key !== key,
    reload,
  };
}
