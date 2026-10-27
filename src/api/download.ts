// Headers for a file that came in an email. The type, the name and the bytes are all chosen by whoever sent it, and the file is served from the
// app's own origin, so the browser must never be allowed to treat it as a page: a document that renders (HTML, SVG, XML, XHTML) runs the
// sender's script with the signed-in user's access to the whole API.

/** Types a browser shows without running anything. Everything else is handed over as a download of unknown type. */
const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|application\/pdf|audio\/(mpeg|mp3|mp4|ogg|wav|x-wav|webm|aac|flac)|video\/(mp4|webm|ogg|quicktime)|text\/(plain|csv))$/;

/** The bare lower-case `type/subtype` of a Content-Type, parameters dropped. */
export function baseType(raw: string | null | undefined): string {
  return String(raw ?? "").split(";")[0].trim().toLowerCase();
}

/** A file name for the plain `filename=` parameter: printable ASCII, nothing that closes the quotes or ends the line. */
export function asciiName(name: string | null | undefined): string {
  const n = String(name || "attachment").replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").trim();
  return n || "attachment";
}

export interface DownloadHeaders {
  [k: string]: string;
}

/**
 * `wantDownload` forces a save dialog. Without it only the types in INLINE_SAFE are shown in the browser; the rest are downloaded anyway,
 * as `application/octet-stream`, so a link that opens one never renders it.
 */
export function attachmentHeaders(filename: string | null | undefined, mimeType: string | null | undefined, wantDownload: boolean, length: number): DownloadHeaders {
  const type = baseType(mimeType);
  const inline = !wantDownload && INLINE_SAFE.test(type);
  const headers: DownloadHeaders = {
    "content-type": INLINE_SAFE.test(type) ? (type === "text/plain" || type === "text/csv" ? `${type}; charset=utf-8` : type) : "application/octet-stream",
    "content-length": String(length),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName(filename)}"; filename*=UTF-8''${encodeURIComponent(filename || "attachment").replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  };
  // If a browser were to render it after all, there is nothing for it to run, load or submit. A PDF viewer does not work under a CSP or inside a
  // sandbox, and a PDF is never read as a page, so a PDF is the one thing that gets none.
  if (type !== "application/pdf") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return headers;
}
