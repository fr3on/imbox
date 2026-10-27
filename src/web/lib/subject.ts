/**
 * A subject split into the words to read and the reference codes to set quietly beside them: "[P01M3P35MMX4BK3N] [Case 7582229]" in
 * "Your support case [P01M3P35MMX4BK3N] [Case 7582229]". Only a bracketed piece that holds a digit and is six characters or more counts,
 * so "[Action required]" and "[External]" stay as they are.
 */
export function subjectParts(subject: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let last = 0;
  for (const m of subject.matchAll(/\[[^\]\n]{6,}\]/g)) {
    if (!/\d/.test(m[0])) continue;
    if (m.index! > last) out.push({ text: subject.slice(last, m.index), code: false });
    out.push({ text: m[0], code: true });
    last = m.index! + m[0].length;
  }
  if (last < subject.length) out.push({ text: subject.slice(last), code: false });
  return out.length ? out : [{ text: subject, code: false }];
}
