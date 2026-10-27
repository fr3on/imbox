// Turns a Teams, Zoom or Meet invite inside a message into a quiet strip with the join link, and lifts it out of any quoted history.

function hoistMeetingStrip(strip: HTMLElement) {
  let quoteWrapper = strip.closest?.('.imbox-quoted-hidden, .imbox-quote, .hey-quote, .outlook-quoted, blockquote, .gmail_quote') as HTMLElement | null;
  while (quoteWrapper) {
    let prev: Element | null = quoteWrapper.previousElementSibling;
    let foldBar: Element | null = null;
    while (prev) {
      if (prev.classList?.contains('inline-fold-bar')) {
        foldBar = prev;
        break;
      }
      if (prev.tagName !== 'BR' && prev.textContent?.trim() !== '') {
         break;
      }
      prev = prev.previousElementSibling;
    }

    if (foldBar) {
      foldBar.parentElement?.insertBefore(strip, foldBar);
    } else {
      quoteWrapper.parentElement?.insertBefore(strip, quoteWrapper);
    }
    quoteWrapper = strip.closest?.('.imbox-quoted-hidden, .imbox-quote, .hey-quote, .outlook-quoted, blockquote, .gmail_quote') as HTMLElement | null;
  }
}

export function enhanceMeetingInvites(doc: Document) {
  // 1. Teams
  const teamsLink = doc.querySelector<HTMLAnchorElement>('a[href*="teams.microsoft.com"], a[href*="teams.live.com"]');
  if (teamsLink && !teamsLink.closest(".strip-bar")) {
    const joinUrl = teamsLink.href;
    let curr: HTMLElement | null = teamsLink;
    let targetBlock: HTMLElement | null = null;
    while (curr && curr !== doc.body) {
      const txt = curr.textContent || "";
      if (curr.tagName === "TABLE" || curr.tagName === "DIV") {
        if (/meeting id/i.test(txt) || /passcode/i.test(txt) || /video conferencing device/i.test(txt)) {
          targetBlock = curr;
          break;
        }
      }
      curr = curr.parentElement;
    }
    if (!targetBlock) targetBlock = teamsLink.closest("table") || teamsLink.closest("div") || teamsLink;

    const blockText = (targetBlock.textContent || "") + " " + (doc.body.textContent || "");
    const idMatch = blockText.match(/Meeting ID:\s*([0-9\s]{8,})/i);
    const passMatch = blockText.match(/Passcode:\s*([A-Za-z0-9]{5,})/i);
    const tenantMatch = blockText.match(/Tenant key:\s*([^\s<]+)/i);
    const videoMatch = blockText.match(/Video ID:\s*([0-9\s]{6,})/i);

    const meetingId = idMatch ? idMatch[1].replace(/\s+/g, " ").trim() : "";
    const passcode = passMatch ? passMatch[1].trim() : "";
    const tenantKey = tenantMatch ? tenantMatch[1].trim() : "";
    const videoId = videoMatch ? videoMatch[1].trim() : "";

    const strip = doc.createElement("div");
    strip.className = "strip-bar";
    strip.innerHTML = `
      <div class="strip-left">
        <span class="strip-title">Teams Meeting</span>
        ${(meetingId || passcode) ? `
          <div class="strip-info">
            ${meetingId ? `<span>ID: ${meetingId}</span> <button type="button" class="strip-copy-btn" data-copy="${meetingId}">Copy</button>` : ""}
            ${passcode ? `<span>Pass: ${passcode}</span> <button type="button" class="strip-copy-btn" data-copy="${passcode}">Copy</button>` : ""}
          </div>
        ` : ""}
      </div>
      <a href="${joinUrl}" target="_blank" rel="noopener noreferrer" class="strip-join">Join meeting</a>
      ${(tenantKey || videoId) ? `
        <details class="strip-details">
          <summary>Device & dial-in info</summary>
          <div style="padding-top:4px;font-family:monospace;font-size:11px;">
            ${tenantKey ? `<div>Tenant key: ${tenantKey}</div>` : ""}
            ${videoId ? `<div>Video ID: ${videoId}</div>` : ""}
          </div>
        </details>
      ` : ""}
    `;
    targetBlock.replaceWith(strip);
    hoistMeetingStrip(strip);
  }

  // 2. Zoom
  const zoomLink = doc.querySelector<HTMLAnchorElement>('a[href*="zoom.us/j/"]');
  if (zoomLink && !zoomLink.closest(".strip-bar")) {
    const joinUrl = zoomLink.href;
    const targetBlock = zoomLink.closest("table") || zoomLink.closest("div") || zoomLink;
    const blockText = (targetBlock.textContent || "") + " " + (doc.body.textContent || "");
    const idMatch = joinUrl.match(/zoom\.us\/j\/(\d+)/i) || blockText.match(/Meeting ID:\s*([0-9\s]+)/i);
    const passMatch = blockText.match(/Passcode:\s*([A-Za-z0-9]+)/i);
    const meetingId = idMatch ? idMatch[1].replace(/\s+/g, "").trim() : "";
    const passcode = passMatch ? passMatch[1].trim() : "";

    const strip = doc.createElement("div");
    strip.className = "strip-bar";
    strip.innerHTML = `
      <div class="strip-left">
        <span class="strip-title">Zoom Meeting</span>
        ${(meetingId || passcode) ? `
          <div class="strip-info">
            ${meetingId ? `<span>ID: ${meetingId}</span> <button type="button" class="strip-copy-btn" data-copy="${meetingId}">Copy</button>` : ""}
            ${passcode ? `<span>Pass: ${passcode}</span> <button type="button" class="strip-copy-btn" data-copy="${passcode}">Copy</button>` : ""}
          </div>
        ` : ""}
      </div>
      <a href="${joinUrl}" target="_blank" rel="noopener noreferrer" class="strip-join">Join meeting</a>
    `;
    targetBlock.replaceWith(strip);
    hoistMeetingStrip(strip);
  }

  // 3. Google Meet
  const meetLink = doc.querySelector<HTMLAnchorElement>('a[href*="meet.google.com/"]');
  if (meetLink && !meetLink.closest(".strip-bar")) {
    const joinUrl = meetLink.href;
    const targetBlock = meetLink.closest("table") || meetLink.closest("div") || meetLink;
    const codeMatch = joinUrl.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    const code = codeMatch ? codeMatch[1] : "";

    const strip = doc.createElement("div");
    strip.className = "strip-bar";
    strip.innerHTML = `
      <div class="strip-left">
        <span class="strip-title">Google Meet</span>
        ${code ? `<div class="strip-info"><span>${code}</span></div>` : ""}
      </div>
      <a href="${joinUrl}" target="_blank" rel="noopener noreferrer" class="strip-join">Join meeting</a>
    `;
    targetBlock.replaceWith(strip);
    hoistMeetingStrip(strip);
  }
}
