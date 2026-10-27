import { sanitizeBrand } from "@shared/brand";

const KEY = "hey.brand";

/** The name seen on the last visit, so a returning visitor never sees the default flash before the real one. */
export function readBrand(store?: Pick<Storage, "getItem">): string | null {
  try {
    const v = (store ?? localStorage).getItem(KEY);
    return v ? sanitizeBrand(v) : null;
  } catch {
    return null;
  }
}

export function writeBrand(name: string, store?: Pick<Storage, "setItem">): void {
  try {
    (store ?? localStorage).setItem(KEY, sanitizeBrand(name));
  } catch {
    /* ignore */
  }
}
