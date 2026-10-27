import { describe, expect, it } from "vitest";
import { amountOf } from "../../src/shared/amount";

// The amount shown beside a receipt on the Updates page.

describe("amountOf", () => {
  it("takes the renewal price, not the account balance that comes later", () => {
    const body = [
      "Hello,",
      "Heads up! You have some renewals coming up in 7 days.",
      "Domain Expiry Date Price Auto-Renew",
      "75status.com 2026-10-10 $18.99 ON Renew Now",
      "If you prefer to use your Hover account balance to pay, your available balance is $0.00. We'll automatically use the payment method on file.",
    ].join("\n");
    expect(amountOf("Your Hover domain 75status.com is coming up for renewal in 7 days", body)).toEqual({ text: "$18.99" });
  });

  it("reads a price with a trailing note", () => {
    expect(amountOf("Pharaoh, 0x200.com will expire in 30 days - renew now", "Domain(s) Due for Renewal on November 1, 2026\nName Auto-Renewal Price\n0x200.com - $18.68*\n* Applicable fees and taxes may apply.")).toEqual({ text: "$18.68" });
  });

  it("still prefers the total line", () => {
    expect(amountOf("Your receipt", "Item $5.00\nTotal $12.50")).toEqual({ text: "$12.50" });
  });

  it("shows a zero only when it is all there is", () => {
    expect(amountOf("Your invoice", "Total: $0.00")).toEqual({ text: "$0.00" });
  });

  it("shows nothing when the mail states no amount", () => {
    expect(amountOf("Hello", "No figures here")).toBeNull();
  });
});
