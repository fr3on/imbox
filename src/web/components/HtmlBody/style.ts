// The stylesheet the message frame is given: the page's own look, and the parts the app adds (quote folds, meeting strips, banners).

import type { readTheme } from "./theme";

export function baseStyle(t: ReturnType<typeof readTheme>, ownBg: boolean) {
  // Plain messages follow the app theme. Designed (painted) messages keep their light canvas.
  // The iframe's color-scheme must match the page, otherwise browsers paint an opaque white canvas in dark mode.
  const scheme = ownBg ? "light" : t.dark ? "dark" : "light";
  const fg = ownBg ? "#37352f" : t.fg;
  const muted = ownBg ? "rgba(55,53,47,.65)" : t.muted;
  const border = ownBg ? "rgba(55,53,47,.12)" : t.border;
  const stripBg = ownBg ? "#fbfbfa" : t.dark ? "rgba(255,255,255,0.03)" : "rgba(55,53,47,0.03)";
  const btnBg = fg;
  const btnFg = ownBg ? "#ffffff" : t.bg;
  return `
  html{color-scheme:${scheme};}
  html,body{margin:0;padding:0;background:transparent;}
  body{display:flow-root;font-family:"Geist Variable",Geist,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:${fg};word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100% !important;height:auto;}
  table{max-width:100% !important;}
  a{color:${fg};text-decoration:underline;text-underline-offset:2px;}
  blockquote{border-left:2px solid ${border};margin:.5em 0;padding-left:1em;color:${muted};}
  pre{white-space:pre-wrap;font-family:"Geist Mono Variable","Geist Mono",ui-monospace,Menlo,monospace;font-size:12.5px;}
  ::selection{background:${fg};color:${ownBg ? "#ffffff" : t.bg};}
  .imbox-quoted-hidden{display:none !important;}

  /* Option B: Quiet strip for conference meetings */
  .strip-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 13px;border:1px solid ${border};border-radius:8px;background:${stripBg};margin:16px 0;box-sizing:border-box;flex-wrap:wrap;}
  .strip-left{display:flex;align-items:center;gap:10px;font-size:13px;min-width:0;flex-wrap:wrap;}
  .strip-title{font-weight:600;color:${fg};letter-spacing:-0.01em;}
  .strip-info{display:flex;align-items:center;gap:10px;color:${muted};font-size:12px;font-family:"Geist Mono Variable","Geist Mono",ui-monospace,Menlo,monospace;}
  .strip-copy-btn{border:1px solid ${border};background:transparent;color:${muted};font-size:10.5px;padding:1px 6px;border-radius:4px;cursor:pointer;font-family:inherit;}
  .strip-copy-btn:hover{color:${fg};border-color:${fg};}
  .strip-join{border:1px solid ${btnBg};background:${btnBg};color:${btnFg} !important;padding:5px 13px;border-radius:6px;font-size:12px;font-weight:500;text-decoration:none !important;white-space:nowrap;cursor:pointer;flex-shrink:0;transition:opacity .15s ease;}
  .strip-join:hover{opacity:.88;}
  .strip-details{width:100%;margin-top:6px;font-size:11.5px;color:${muted};}
  .strip-details summary{cursor:pointer;color:${muted};outline:none;}
  .strip-details summary:hover{color:${fg};}

  /* Caution & sensitivity banners */
  .caution-banner-subtle{border:1px solid rgba(239,68,68,.25) !important;border-left:3px solid #ef4444 !important;background:${ownBg ? "rgba(239,68,68,.05)" : t.dark ? "rgba(239,68,68,.08)" : "rgba(239,68,68,.05)"} !important;padding:6px 10px !important;border-radius:6px !important;font-size:11.5px !important;line-height:1.4 !important;color:${muted} !important;margin:12px 0 !important;}
  .caution-banner-subtle *{font-size:11.5px !important;font-weight:normal !important;color:inherit !important;}
  .caution-banner-subtle b,.caution-banner-subtle strong{font-weight:600 !important;color:${fg} !important;}
  .email-sensitivity-label{display:inline-block !important;font-size:11px !important;font-weight:500 !important;color:${muted} !important;background:${ownBg ? "rgba(55,53,47,.06)" : t.dark ? "rgba(255,255,255,.06)" : "rgba(55,53,47,.06)"} !important;border:1px solid ${border} !important;padding:1px 8px !important;border-radius:999px !important;margin-bottom:8px !important;letter-spacing:normal !important;}

  /* Outlook & divider normalization */
  hr{border:0;border-top:1px solid ${border};margin:1.25rem 0;opacity:.5;}
  p.MsoNormal,li.MsoNormal,div.MsoNormal{margin-bottom:.5em;}
  p:empty, p.MsoNormal:empty{margin:0 !important;padding:0 !important;min-height:0 !important;}

  /* Option A: Inline Quote Fold */
  .inline-fold-bar{position:relative;display:flex;align-items:center;justify-content:center;margin:18px 0 12px;}
  .inline-fold-bar::before{content:"";position:absolute;inset-inline:0;top:50%;border-top:1px dashed ${border};z-index:1;}
  .inline-fold-btn{position:relative;z-index:2;background:${ownBg ? "#ffffff" : t.bg};border:1px solid ${border};border-radius:999px;padding:3px 12px;font-size:11.5px;color:${muted};display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-family:inherit;transition:all .15s ease;}
  .inline-fold-btn:hover{color:${fg};border-color:${fg};background:${stripBg};}
  .inline-fold-btn .fold-chevron{width:13px;height:13px;stroke-width:2;stroke:currentColor;fill:none;transition:transform .15s ease;}
  .inline-fold-btn.is-open .fold-chevron{transform:rotate(180deg);}
  .inline-fold-btn .fold-badge{font-family:"Geist Mono Variable","Geist Mono",ui-monospace,Menlo,monospace;font-size:10.5px;background:${stripBg};border:1px solid ${border};padding:0 6px;border-radius:999px;color:${muted};}
  
  .outlook-quoted, blockquote, .gmail_quote{border-left:2px solid ${border} !important;padding-left:14px !important;margin-left:4px !important;margin-top:8px !important;}
  .outlook-quoted.imbox-quoted-hidden, blockquote.imbox-quoted-hidden, .gmail_quote.imbox-quoted-hidden{display:none !important;}
`;
}
