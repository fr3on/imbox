// A plain-text check for the commonest phishing. Three tells, each only when the mail also presses you to act:
//   - it puts on a well-known name (Netflix, PayPal, a bank) but was not sent from that company's domain;
//   - its sender name is a web address ("0x200.com") that is not the domain it was sent from;
//   - it talks about the password or mailbox of your own domain, but was sent from somewhere else;
//   - replies go to a different domain, or a link says one address and goes to another, or hides where it goes;
//   - the receiving server could not verify the sender (SPF, DKIM, DMARC), which makes any of the above stronger.
// What the owner decided before (Report, "Looks fine") comes first. It only ever raises a question ("This may be phishing"); the person decides.

interface Brand {
  name: string;
  /** How the name is written in mail. */
  re: RegExp;
  /** The domains the company really sends from (and their subdomains). */
  domains: string[];
}

const BRANDS: Brand[] = [
  { name: "Netflix", re: /\bnetflix\b/gi, domains: ["netflix.com", "nflxext.com"] },
  { name: "PayPal", re: /\bpaypal\b/gi, domains: ["paypal.com", "paypal.me", "paypal-communication.com"] },
  { name: "Apple", re: /\b(?:apple id|apple music|apple pay|icloud|apple)\b/gi, domains: ["apple.com", "icloud.com", "me.com", "itunes.com"] },
  { name: "Amazon", re: /\bamazon\b/gi, domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.it", "amazon.es", "amazon.ae", "amazon.sa", "amazon.eg", "amazon.in", "amazonaws.com", "amazon.com.au", "amazon.ca", "amazon.co.jp"] },
  { name: "Microsoft", re: /\b(?:microsoft|office 365|microsoft 365|outlook)\b/gi, domains: ["microsoft.com", "microsoftonline.com", "outlook.com", "office.com", "office365.com", "live.com", "hotmail.com", "msn.com", "azure.com"] },
  { name: "Google", re: /\bgoogle\b/gi, domains: ["google.com", "gmail.com", "youtube.com", "googlemail.com", "withgoogle.com"] },
  { name: "Facebook", re: /\bfacebook\b/gi, domains: ["facebook.com", "facebookmail.com", "meta.com", "fb.com"] },
  { name: "Instagram", re: /\binstagram\b/gi, domains: ["instagram.com", "facebookmail.com"] },
  { name: "LinkedIn", re: /\blinkedin\b/gi, domains: ["linkedin.com"] },
  { name: "DHL", re: /\bdhl\b/gi, domains: ["dhl.com", "dhl.de"] },
  { name: "FedEx", re: /\bfedex\b/gi, domains: ["fedex.com"] },
  { name: "UPS", re: /\bUPS\b/g, domains: ["ups.com"] },
  { name: "Dropbox", re: /\bdropbox\b/gi, domains: ["dropbox.com", "dropboxmail.com"] },
  { name: "Spotify", re: /\bspotify\b/gi, domains: ["spotify.com"] },
  { name: "Chase", re: /\bChase\b/g, domains: ["chase.com", "jpmorgan.com", "jpmorganchase.com"] },
  { name: "Bank of America", re: /\bbank of america\b/gi, domains: ["bankofamerica.com", "bofa.com", "ml.com"] },
  { name: "Wells Fargo", re: /\bwells fargo\b/gi, domains: ["wellsfargo.com"] },
];

/** The language that tries to rush you. */
const PRESSURE =
  /\b(?:immediate action|act now|last (?:chance|opportunity|warning)|final (?:notice|warning)|account (?:is |has been |was )?(?:restricted|suspended|locked|limited|disabled|closed|on hold)|verify your|confirm your (?:account|identity|payment|details)|update your (?:payment|billing|account)|unusual (?:activity|sign-?in)|will be (?:closed|terminated|suspended|deleted)|within \d+ (?:hours|days)|expires? (?:today|soon|in)|renew now|click (?:here|below))\b/i;

/** Language that goes after a login: a password about to lapse, a full mailbox, an account about to be blocked. */
const LOGIN_PRESSURE =
  /\b(?:password\b(?:[^.!?]|\.(?=\S)){0,60}?\b(?:expire|expiry|expiring|lapse)|(?:keep|retain|maintain) (?:the )?same password|(?:mailbox|storage|quota)(?: is)? (?:full|almost full|exceeded)|(?:failure|fail) to (?:update|verify|confirm|respond|act)|(?:temporary|temporarily) (?:block|suspen|disabl|restrict|lock)\w*|(?:will be|be) (?:blocked|disabled|deactivated|locked)|re-?validate|re-?activate your)\b/i;
/** The words of a login. */
const LOGIN_WORDS = /\b(?:password|passcode|mailbox|e-?mail account|webmail|log-?in|sign-?in|credentials)\b/i;
/** A web address as someone's name: "0x200.com", "Support at paypal.com". */
const ADDRESS_IN_NAME = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;
/** Mailboxes anyone can have; a mail that mentions "gmail.com" is not talking about your own domain. */
const SHARED_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "msn.com"]);

/** How likely, from 0 to 1, a fast AI check has to rate a message before it is called phishing. */
export const JEV_PHISHING_FROM = 0.6;

/** Whether anyone can have an address here (gmail.com, outlook.com): a verdict about one sender there is not a verdict about the whole domain. */
export const isSharedMailDomain = (domain: string) => SHARED_DOMAINS.has(domain.toLowerCase());

export interface PhishingSource {
  from: { email: string; name?: string };
  /** Who it was sent to, so mail about your own domain can be told from mail about someone else's. */
  to?: { email: string }[];
  /** Where replies go, when that is not the sender. */
  reply_to?: string;
  /** What the receiving server said about the sender: "spf=pass dkim=pass dmarc=fail". */
  auth?: string;
  /** What the owner decided about this sender or its domain before. */
  verdict?: "bad" | "ok" | null;
  subject?: string;
  text_body?: string;
  html_body?: string;
  is_from_me?: boolean;
}

export interface PhishingSignal {
  brand: string;
  domain: string;
  /** One sentence for the banner. */
  reason: string;
}

const domainOf = (email: string) => email.split("@").pop()?.trim().toLowerCase() ?? "";
const belongsTo = (domain: string, domains: string[]) => domains.some((d) => domain === d || domain.endsWith(`.${d}`));
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
/** The same site: one is the other, or a subdomain of it. */
const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/** Sending services whose links are rewritten through their own address: a link there says nothing about who wrote the mail. */
const TRACKING_HOSTS = ["sendgrid.net", "mandrillapp.com", "mailchimp.com", "list-manage.com", "mcsv.net", "rs6.net", "constantcontact.com", "amazonses.com", "mailgun.org", "mailgun.net", "sparkpostmail.com", "hubspotlinks.com", "hubspot.com", "klaviyomail.com", "klclick.com", "customeriomail.com", "convertkit-mail.com", "substack.com", "beehiiv.com", "postmarkapp.com", "pstmrk.it", "sendinblue.com", "brevo.com", "mjt.lu", "mailjet.com", "ct.sendgrid.net", "google.com", "gstatic.com", "w3.org"];
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rebrand.ly", "shorturl.at", "tiny.cc", "buff.ly"];
const hostOf = (url: string): string => {
  const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i.exec(url.trim());
  if (!m) return "";
  return m[1].replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase();
};

interface Link {
  /** What the link says it is, when that looks like an address. */
  says: string;
  /** Where it goes. */
  host: string;
  userinfo: boolean;
}

/** The links of an HTML message: where each goes, and the address its text claims, if any. */
function linksOf(html: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m && out.length < 60; m = re.exec(html)) {
    const href = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!/^https?:/i.test(href)) continue;
    const host = hostOf(href);
    if (!host) continue;
    const text = m[3].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const says = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]|$)/i.exec(text)?.[1]?.toLowerCase() ?? "";
    out.push({ says, host, userinfo: /^https?:\/\/[^/?#]*@/i.test(href) });
  }
  return out;
}

const isIp = (h: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(":");
const isTracking = (h: string) => TRACKING_HOSTS.some((d) => sameSite(h, d));
/** The sender could not be verified: DMARC failed, or SPF failed with no valid signature to fall back on. */
const authFailed = (auth: string | undefined) => /\bdmarc=fail\b/i.test(auth ?? "") || (/\bspf=(?:fail|softfail)\b/i.test(auth ?? "") && !/\bdkim=pass\b/i.test(auth ?? ""));

/** Whether a message looks like phishing, and the one sentence that says why. Null when it does not. */
export function phishingSignal(m: PhishingSource): PhishingSignal | null {
  if (m.is_from_me) return null;
  const domain = domainOf(m.from.email);
  if (!domain) return null;
  // What the owner said before comes first: "Looks fine" ends the question, and a Report is remembered.
  if (m.verdict === "ok") return null;
  if (m.verdict === "bad") return { brand: domain, domain, reason: `You reported mail from ${domain} before.` };
  const html = m.html_body ?? "";
  const body = (m.text_body || html.replace(/<style[\s\S]*?<\/style>|<[^>]*>/gi, " ")).replace(/\s+/g, " ").slice(0, 6000);
  const subject = m.subject ?? "";
  const named = `${m.from.name ?? ""} ${subject}`;
  const text = `${subject} ${body}`;
  const pressed = PRESSURE.test(text) || LOGIN_PRESSURE.test(text);
  // Pressure about a login: its own words, or the usual rushing next to the words of a login.
  const loginPressed = LOGIN_PRESSURE.test(text) || (pressed && LOGIN_WORDS.test(text));
  const unverified = authFailed(m.auth);
  const hit = (brand: string, reason: string): PhishingSignal => ({ brand, domain, reason: unverified ? `${reason} The server that received it could not verify the sender.` : reason });

  for (const b of BRANDS) {
    if (belongsTo(domain, b.domains)) continue;
    // The sender's own domain naming the brand ("netflix-support.example") is itself the tell, but a company that merely shares a word is not.
    const inName = count(named, b.re) > 0;
    const inBody = count(body, b.re);
    if (!pressed) continue;
    if (inName || inBody >= 2) return hit(b.name, `It says ${b.name}, but it was sent from ${domain}.`);
  }
  const named_ = ADDRESS_IN_NAME.exec(m.from.name ?? "")?.[1]?.toLowerCase();
  if (named_ && loginPressed && !sameSite(domain, named_)) return hit(named_, `The name says ${named_}, but it was sent from ${domain}.`);
  const own = (m.to ?? []).map((r) => domainOf(r.email)).filter((d) => d && !SHARED_DOMAINS.has(d));
  if (loginPressed) {
    const lower = text.toLowerCase();
    const mine = own.find((d) => !sameSite(domain, d) && lower.includes(d));
    if (mine) return hit(mine, `It talks about your ${mine} account, but it was sent from ${domain}.`);
  }
  const replyDomain = domainOf(m.reply_to ?? "");
  if (pressed && replyDomain && !sameSite(replyDomain, domain) && !isTracking(replyDomain)) return hit(replyDomain, `Replies go to ${replyDomain}, not ${domain}.`);

  if (pressed) {
    const links = linksOf(html);
    for (const l of links) {
      if (l.userinfo) return hit(l.host, `A link hides its real address: it goes to ${l.host}.`);
      if (isIp(l.host)) return hit(l.host, `A link goes straight to a number (${l.host}), not to a website name.`);
      if (l.host.split(".").some((part) => part.startsWith("xn--"))) return hit(l.host, `A link goes to ${l.host}, which uses look-alike characters.`);
      if (SHORTENERS.some((d) => sameSite(l.host, d))) return hit(l.host, `A link is shortened (${l.host}), so you can't see where it goes.`);
      if (l.says && !sameSite(l.says, l.host) && !isTracking(l.host)) return hit(l.host, `A link says ${l.says}, but goes to ${l.host}.`);
    }
    if (loginPressed) {
      // A real notice about a login links to the company that sent it, or to your own domain, or through its sending service.
      const away = links.find((l) => !sameSite(l.host, domain) && !isTracking(l.host) && !own.some((d) => sameSite(l.host, d)));
      if (away) return hit(away.host, `The link goes to ${away.host}, not ${domain}.`);
    }
  }
  // Nothing else is wrong with it, but the sender is not who the From line says and it is pressing you.
  if (pressed && unverified) return { brand: domain, domain, reason: `It presses you to act, and the server that received it could not verify it came from ${domain}.` };
  return null;
}
