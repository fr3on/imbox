import { useEffect, useState } from "react";

/** A value that follows `value` after it has stayed put for `ms`, so typing does not ask the server at every key. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}
