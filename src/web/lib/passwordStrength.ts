/** 0-4: length first, then a mix of cases, digits and symbols. A nudge only; the server's rule is the length. */
export function passwordStrength(pw: string): number {
  if (pw.length < 8) return pw ? 1 : 0;
  const mix = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return Math.min(4, (pw.length >= 12 ? 2 : 1) + (mix >= 3 ? 1 : 0) + (pw.length >= 16 ? 1 : 0));
}
