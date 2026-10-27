// Folds the quoted history of a message behind a bar, whichever mail program wrote it.

// Elements that mail clients use to wrap the quoted history of a thread.
export const QUOTE_SELECTOR = [".gmail_quote", "blockquote", ".yahoo_quoted", "#divRplyFwdMsg", "#appendonsend", ".moz-cite-prefix", ".protonmail_quote", "div[id^='yiv'] blockquote", ".imbox-quote", ".hey-quote", ".outlook-quoted"].join(",");

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatHeaderTime(str: string): string {
  const timeMatch = str.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i);
  if (timeMatch) return timeMatch[1];
  const dateMatch = str.match(/\b([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b/);
  if (dateMatch) return dateMatch[1];
  return str.slice(0, 16).trim();
}

export function wrapOutlookQuotes(doc: Document) {
  if (doc.querySelector(".outlook-quoted")) return;

  let startEl: HTMLElement | null = null;
  let detectedSender = "";
  let detectedDate = "";

  // 1. Explicit Outlook Web App container
  const rplyDiv = doc.querySelector<HTMLElement>("#divRplyFwdMsg");
  if (rplyDiv) {
    startEl = rplyDiv;
    const txt = rplyDiv.textContent || "";
    const sm = txt.match(/(?:From|من|De|Von)\s*:\s*([^<\r\n,;]+)/i);
    if (sm) detectedSender = sm[1].trim();
    const dm = txt.match(/(?:Sent|Date|Envoyé|Gesendet|تاريخ)\s*:\s*([^\r\n;]+)/i);
    if (dm) detectedDate = formatHeaderTime(dm[1].trim());
  }

  // 2. Scan elements for Outlook headers or "Original Message"
  if (!startEl) {
    const candidates = Array.from(doc.body.querySelectorAll<HTMLElement>("p, div, font, table, b, strong, span, td"));
    for (const el of candidates) {
      if (el.children.length > 50) continue;
      const txt = (el.textContent || "").trim();
      if (!txt) continue;

      // "-----Original Message-----" or variants
      if (/^-----?\s*(?:Original Message|Message d'origine|Ursprüngliche Nachricht|الرسالة الأصلية)\s*-----?/i.test(txt)) {
        startEl = el;
        break;
      }

      // "From:" header pattern
      if (/(?:^|\n|\r|\s)(?:From|De|Von|من)\s*:\s*\S+/i.test(txt)) {
        let headerText = txt;
        const parent = el.parentElement;
        if (parent && parent !== doc.body && (parent.textContent || "").length < 5000) {
          headerText = parent.textContent || "";
        } else {
          let sib = el.nextElementSibling;
          let count = 0;
          while (sib && count < 5) {
            headerText += " " + (sib.textContent || "");
            sib = sib.nextElementSibling;
            count++;
          }
        }

        const hasSent = /\b(?:Sent|Date|Envoyé|Gesendet|تاريخ|التاريخ)\s*:\s*\S+/i.test(headerText);
        const hasToOrSubject = /\b(?:To|À|An|إلى|Subject|Objet|Betreff|الموضوع)\s*:\s*\S+/i.test(headerText);
        const hasEmailOrBracket = /[@<>]/.test(headerText);

        if (hasSent && (hasToOrSubject || hasEmailOrBracket)) {
          startEl = el;
          const sm = headerText.match(/(?:From|من|De|Von)\s*:\s*([^<\r\n,;]+)/i);
          if (sm) detectedSender = sm[1].trim();
          const dm = headerText.match(/(?:Sent|Date|Envoyé|Gesendet|تاريخ)\s*:\s*([^\r\n;]+)/i);
          if (dm) detectedDate = formatHeaderTime(dm[1].trim());
          break;
        }
      }

      // Unquoted "On ... wrote:" header
      if (/^On\s+.{5,120}\s+wrote:\s*$/i.test(txt) || /^في\s+.{5,120}\s+كتب:\s*$/i.test(txt)) {
        if (!el.closest("blockquote, .gmail_quote")) {
          startEl = el;
          const m = txt.match(/On\s+(.*?)\s+wrote:/i) || txt.match(/في\s+(.*?)\s+كتب:/i);
          if (m) {
            const inner = m[1];
            detectedSender = inner.replace(/<[^>]+>/, "").replace(/at\s+\d{1,2}:\d{2}.*/i, "").trim();
            detectedDate = formatHeaderTime(inner);
          }
          break;
        }
      }
    }
  }

  if (!startEl) return;

  // 3. Find boundary: include preceding <hr> or styled divider if present
  let boundary: HTMLElement = startEl;
  const prev = boundary.previousElementSibling as HTMLElement | null;
  if (prev && (prev.tagName === "HR" || /border-(?:top|bottom)/i.test(prev.getAttribute("style") || ""))) {
    boundary = prev;
  }

  // 4. Climb up to the appropriate container level
  while (
    boundary.parentElement &&
    boundary.parentElement !== doc.body &&
    boundary.parentElement.tagName !== "BODY"
  ) {
    const parent = boundary.parentElement;
    if (parent.classList.contains("WordSection1") || parent === doc.body) {
      break;
    }

    const isHeaderWrapper =
      parent.id === "divRplyFwdMsg" ||
      /border-(?:top|bottom)/i.test(parent.getAttribute("style") || "") ||
      parent.tagName === "FONT" ||
      parent.children.length <= 4;

    if (isHeaderWrapper) {
      boundary = parent;
      const pPrev = boundary.previousElementSibling as HTMLElement | null;
      if (pPrev && (pPrev.tagName === "HR" || /border-(?:top|bottom)/i.test(pPrev.getAttribute("style") || ""))) {
        boundary = pPrev;
      }
    } else {
      break;
    }
  }

  // 5. Wrap boundary and all following siblings
  const container = boundary.parentElement;
  if (!container) return;

  const toWrap: Node[] = [];
  let curr: Node | null = boundary;
  while (curr) {
    const next: Node | null = curr.nextSibling;
    toWrap.push(curr);
    curr = next;
  }

  if (toWrap.length > 0) {
    const wrapper = doc.createElement("div");
    wrapper.className = "imbox-quote outlook-quoted imbox-quoted-hidden";
    container.insertBefore(wrapper, boundary);
    for (const n of toWrap) {
      wrapper.appendChild(n);
    }

    // Option A: Insert inline fold pill right at the break point
    const wrapperText = wrapper.textContent?.slice(0, 500) || "";
    const isForwarded = /forwarded message|رسالة محولة/i.test(wrapperText) || 
                        /forwarded message|رسالة محولة/i.test(boundary.previousElementSibling?.textContent || "") ||
                        /forwarded message|رسالة محولة/i.test(boundary.textContent || "");
    const actionWord = isForwarded ? "Forwarded" : "Quoted";

    const foldBar = doc.createElement("div");
    foldBar.className = "inline-fold-bar";
    foldBar.innerHTML = `
      <button type="button" class="inline-fold-btn" data-sender="${escapeHtml(detectedSender)}" data-action="${actionWord}" aria-expanded="false">
        <svg class="fold-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="fold-title">${actionWord} message${detectedSender ? ` from ${escapeHtml(detectedSender)}` : ""}</span>
        ${detectedDate ? `<span class="fold-badge">${escapeHtml(detectedDate)}</span>` : ""}
      </button>
    `;
    container.insertBefore(foldBar, wrapper);
  }
}

export function enhanceGmailQuotes(doc: Document) {
  const quotes = Array.from(doc.body.querySelectorAll<HTMLElement>("blockquote, .gmail_quote"));
  for (const q of quotes) {
    if (q.closest(".outlook-quoted") || q.previousElementSibling?.classList.contains("inline-fold-bar")) continue;

    let sender = "";
    let dateStr = "";
    const prev = q.previousElementSibling as HTMLElement | null;
    if (prev) {
      const pTxt = (prev.textContent || "").trim();
      if (/^On\s+.{5,120}\s+wrote:\s*$/i.test(pTxt) || /^في\s+.{5,120}\s+كتب:\s*$/i.test(pTxt)) {
        const m = pTxt.match(/On\s+(.*?)\s+wrote:/i) || pTxt.match(/في\s+(.*?)\s+كتب:/i);
        if (m) {
          const inner = m[1];
          const emailMatch = inner.match(/<([^>]+)>/);
          const namePart = inner.replace(/<[^>]+>/, "").replace(/at\s+\d{1,2}:\d{2}.*/i, "").trim();
          sender = namePart || emailMatch?.[1] || "";
          dateStr = formatHeaderTime(inner);
        }
        prev.style.setProperty("display", "none", "important");
      }
    }

    q.classList.add("imbox-quoted-hidden");

    const wrapperText = q.textContent?.slice(0, 500) || "";
    const isForwarded = /forwarded message|رسالة محولة/i.test(wrapperText);
    const actionWord = isForwarded ? "Forwarded" : "Quoted";

    const foldBar = doc.createElement("div");
    foldBar.className = "inline-fold-bar";
    foldBar.innerHTML = `
      <button type="button" class="inline-fold-btn" data-sender="${escapeHtml(sender)}" data-action="${actionWord}" aria-expanded="false">
        <svg class="fold-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="fold-title">${actionWord} message${sender ? ` from ${escapeHtml(sender)}` : ""}</span>
        ${dateStr ? `<span class="fold-badge">${escapeHtml(dateStr)}</span>` : ""}
      </button>
    `;
    q.parentElement?.insertBefore(foldBar, q);
  }
}
