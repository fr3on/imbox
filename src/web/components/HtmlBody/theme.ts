import { useEffect, useState } from "react";

/** Reads the app's current grayscale palette so the iframe can follow the theme. */
export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    dark: document.documentElement.classList.contains("dark"),
    fg: get("--foreground", "#37352f"),
    bg: get("--background", "#ffffff"),
    muted: get("--muted-foreground", "rgba(55,53,47,.65)"),
    border: get("--border", "rgba(55,53,47,.09)"),
  };
}

export function useTheme() {
  const [t, setT] = useState(readTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setT(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return t;
}
