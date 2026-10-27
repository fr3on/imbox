import type { Message } from "@shared/types";
import { sanitizeEmailHtml } from "../components/HtmlBody";
import { fmtFull, textToHtml } from "./format";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const person = (a: { name?: string; email: string }) => (a.name ? `${esc(a.name)} &lt;${esc(a.email)}&gt;` : esc(a.email));

/** A page ready to print: the subject, then each message with who wrote it, to whom, when, and its own text. */
export function printDocument(subject: string, messages: Message[]): string {
  const sections = messages
    .map((m) => {
      const body = sanitizeEmailHtml(m.html_body || textToHtml(m.text_body || ""));
      const files = m.attachments.filter((a) => !a.is_inline).map((a) => esc(a.filename || "attachment"));
      return `<section class="m">
  <div class="h">
    <div><b>From:</b> ${m.is_from_me ? "You " : ""}${person(m.from)}</div>
    ${m.to.length ? `<div><b>To:</b> ${m.to.map(person).join(", ")}</div>` : ""}
    ${m.cc.length ? `<div><b>Cc:</b> ${m.cc.map(person).join(", ")}</div>` : ""}
    <div><b>Date:</b> ${esc(fmtFull(m.date))}</div>
    ${files.length ? `<div><b>Attachments:</b> ${files.join(", ")}</div>` : ""}
  </div>
  <div class="b">${body}</div>
</section>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(subject || "Message")}</title><style>
    body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;margin:0;padding:24px;background:#fff}
    h1{font-size:20px;margin:0 0 16px}
    .m{margin:0 0 28px;padding:0 0 24px;border-bottom:1px solid #ccc}
    .m:last-child{border-bottom:0}
    .h{font-size:13px;color:#333;padding:0 0 10px;margin:0 0 14px;border-bottom:1px solid #e3e3e3}
    .h div{margin:1px 0}
    .b{overflow-wrap:anywhere}.b img{max-width:100%;height:auto}.b table{max-width:100%}
    @media print{body{padding:0}a{color:inherit;text-decoration:none}.m{page-break-inside:auto}}
  </style></head><body><h1>${esc(subject || "(no subject)")}</h1>${sections}</body></html>`;
}

/**
 * Print messages: a hidden page is built, sanitised like the reader does it, and printed from a frame that cannot run scripts.
 * The frame is taken away afterwards.
 */
export function printMessages(subject: string, messages: Message[]): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = printDocument(subject, messages);
  frame.onload = () => {
    // Let images settle before the print dialog takes its snapshot.
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 300);
  };
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 120_000);
}
