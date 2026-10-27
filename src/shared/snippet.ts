// Where a reply's own words stop and the message it quotes begins: Gmail's "On <date> <name> wrote:", Outlook's
// "From: … Sent: …" header block, and a run of ">" quote markers.
const QUOTE_START = /\bOn\s.{4,200}?\swrote:|\bFrom:\s.{0,160}?\sSent:\s|\s>\s+(?:>|\w)/i;

/** The reply itself, without the earlier messages it quotes. Left whole when nothing precedes the quote. */
function withoutQuotedReply(text: string): string {
  const at = text.search(QUOTE_START);
  return at >= 8 ? text.slice(0, at).trim() : text;
}

/** A preview line as a person would read it: no markup, no image placeholders, no leftover entities, no quoted replies. */
export function cleanSnippet(text: string): string {
  return withoutQuotedReply(
    text
      .replace(/<[^>]*>?/g, " ")
      .replace(/\[Image:[^\]]*\]?/gi, " ")
      // A link written out beside its text: "Jira [https://…]", "(https://…)", or a bare address.
      .replace(/\[\s*(?:https?:\/\/|mailto:|www\.)[^\]\s]*\s*\]/gi, " ")
      .replace(/[(<]\s*(?:https?:\/\/|mailto:|www\.)[^)>\s]*\s*[)>]/gi, " ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
      .replace(/&(nbsp|zwnj|zwj|#8203|#8204);?/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#8211;|&ndash;/g, "–")
      .replace(/&#8217;|&rsquo;/g, "’")
      .replace(/&#?\w+;/g, " ")
      .replace(/[=\-_*]{4,}/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}
