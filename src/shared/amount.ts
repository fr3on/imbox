// The amount a receipt states, so the Updates page can show it beside the sender. Only an amount the mail actually states is shown: a figure
// is taken when it is written with a currency sign or code, and a line that says "total", "paid" or the like wins over any other figure.

const SYMBOL = "[€$£¥₹]";
const CODE = "(?:USD|EUR|GBP|CAD|AUD|CHF|SAR|AED|JPY|INR|SEK|NOK|DKK)";
const NUM = "\\d{1,3}(?:[,\\s]\\d{3})*(?:\\.\\d{2})?|\\d+(?:\\.\\d{2})?";
// "€214.00", "$ 19", "USD 19.00", "19.00 EUR"
const AMOUNT = new RegExp(`(${SYMBOL})\\s?(${NUM})|\\b(${CODE})\\s?(${NUM})\\b|\\b(${NUM})\\s?(${CODE})\\b`, "g");
const TOTAL = /\b(total|amount (?:due|paid|charged)|paid|charged|you paid|grand total|balance due|renewal price|price|renews? (?:at|for))\b/i;
// Words that put a figure beside a limit, an offer or a balance you hold, not a payment.
const NOT_A_PAYMENT = /\b(save|off|discount|up to|from only|starting at|free shipping over|credit of|(?:available|account|remaining|current) (?:balance|credit)|account credit)\b/i;

export interface Amount {
  /** What to show: "€214.00". */
  text: string;
}

const clean = (n: string) => n.replace(/\s/g, "");

function format(m: RegExpExecArray): string {
  if (m[1]) return `${m[1]}${clean(m[2])}`;
  if (m[3]) return `${m[3]} ${clean(m[4])}`;
  return `${clean(m[5])} ${m[6]}`;
}

/** The first amount in the text. A zero is only taken when nothing else is there, so "$0.00 balance" never beats the price. */
function firstIn(text: string): string | null {
  let zero: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (NOT_A_PAYMENT.test(line)) continue;
    AMOUNT.lastIndex = 0;
    for (let m = AMOUNT.exec(line); m; m = AMOUNT.exec(line)) {
      const value = parseFloat((m[2] ?? m[4] ?? m[5]).replace(/[,\s]/g, ""));
      if (value > 0) return format(m);
      zero ??= format(m);
    }
  }
  return zero;
}

/** The amount a receipt states: from a line that talks about a total or a payment first, else the subject's, else the first figure in the text. */
export function amountOf(subject: string, body: string): Amount | null {
  const head = body.slice(0, 4000);
  const totals = head.split(/\r?\n/).filter((l) => TOTAL.test(l)).join("\n");
  const hit = firstIn(subject) ?? (totals ? firstIn(totals) : null) ?? firstIn(head);
  return hit ? { text: hit } : null;
}
