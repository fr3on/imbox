import DOMPurify from "dompurify";

// Every piece of HTML that came from somebody else goes through here before it touches the page: the message itself (inside its own frame) and
// the quoted copy of it that a reply or a forward starts from (which sits in the app's own page, with the signed-in user's access to everything).
// The server only takes tracking pixels out of a message; it does not make HTML safe, and says so.

if (typeof (DOMPurify as any)?.addHook === "function") {
  (DOMPurify as any).addHook("afterSanitizeAttributes", (node: any) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
}

export interface SanitizeOptions {
  /** Drop images that would be fetched from another server (the quoted text in the composer is shown in the app's own page, where nothing may phone home). */
  noRemoteImages?: boolean;
}

export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    // Without this DOMPurify drops a <style> block at the start of the mail (most senders put theirs in <head>), so hidden preheaders and spacers that rely on it show up as a tall empty gap.
    FORCE_BODY: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "meta", "link", "base"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "formaction"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  if (!opts.noRemoteImages) return clean;
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.querySelectorAll("img, source, video, audio, image").forEach((el) => {
    const remote = ["src", "srcset", "poster", "href", "xlink:href"].some((a) => /^\s*(https?:)?\/\//i.test(el.getAttribute(a) ?? ""));
    if (remote) el.remove();
  });
  // A style attribute or a <style> block can fetch too (background-image, @import): the page's own CSP refuses it, and the preview takes it out as well.
  doc.querySelectorAll("style").forEach((s) => s.remove());
  doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (/url\s*\(|@import/i.test(el.getAttribute("style") ?? "")) el.removeAttribute("style");
  });
  return doc.body.innerHTML;
}
