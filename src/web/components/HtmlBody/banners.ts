// Quiets the warning banners and sensitivity labels that mail systems add to the top of a message.

export function enhanceCautionBanners(doc: Document) {
  const CAUTION_REGEX = /CAUTION:\s*This email originated from outside|External email:\s*Use caution|Be careful with this message/i;
  for (const el of Array.from(doc.body.querySelectorAll("div, table, p, td"))) {
    if (el.children.length > 4) continue;
    const txt = el.textContent || "";
    if (CAUTION_REGEX.test(txt) && txt.length < 350) {
      let target: HTMLElement = el as HTMLElement;
      while (
        target.parentElement &&
        target.parentElement !== doc.body &&
        target.parentElement.textContent?.trim().length === txt.trim().length
      ) {
        target = target.parentElement;
      }
      target.classList.add("caution-banner-subtle");
      break;
    }
  }
}

export function enhanceSensitivityLabels(doc: Document) {
  const SENSITIVITY_REGEX = /^(?:Public\s*-\s*عام|Classification\s*:|Sensitivity\s*:|Internal\s*-\s*داخلي|Confidential\s*-\s*سري)/i;
  for (const el of Array.from(doc.body.querySelectorAll("p, div, span, font"))) {
    if (el.children.length > 2) continue;
    const txt = (el.textContent || "").trim();
    if (txt.length > 0 && txt.length < 50 && SENSITIVITY_REGEX.test(txt)) {
      (el as HTMLElement).classList.add("email-sensitivity-label");
      break;
    }
  }
}
