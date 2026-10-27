/** Inline, not a class: the style has to travel with the message to the recipient, where this app's stylesheet does not. */
export const SIG_STYLE = "color:#8a8a8a";

/** The class marks where the signature starts. Drafts saved before the rename carry the old one, so both are recognised. */
export const SIG_CLASS = "imbox-signature";
const OLD_SIG_CLASS = "hey-signature";

export const hasSignature = (html: string): boolean => html.includes(SIG_CLASS) || html.includes(OLD_SIG_CLASS);

export function appendSignature(html: string, sig: string): string {
  if (!sig || hasSignature(html)) return html;
  return `${html}<br><br><div class="${SIG_CLASS}" style="${SIG_STYLE}">${sig}</div>`;
}

export function signatureText(sig: string): string {
  return sig.replace(/<[^>]+>/g, "").trim();
}
