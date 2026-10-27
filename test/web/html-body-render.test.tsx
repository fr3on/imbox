import { describe, expect, it, vi } from "vitest";
import { html, USER } from "./render";
import { HtmlBody } from "@/components/HtmlBody";
import type { QueryClient } from "@tanstack/react-query";

// What the message frame and the notices above it show when it is first drawn, before the frame has loaded: the trackers that were blocked, the
// images that were held back, and the document the frame is given with the policy that decides what it may fetch. The server's sanitiser needs a browser,
// so here it hands the message back unchanged; what it does has its own tests.

vi.mock("@/lib/sanitizeHtml", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sanitizeEmailHtml: (h: string) => h }));

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The frame's document, read back out of the attribute it travels in. */
const srcdoc = (markup: string) => unescape(/srcDoc="([^"]*)"/.exec(markup)?.[1] ?? "");
/** The markup with the frame's document taken out, which is long and has its own tests. */
const shell = (markup: string) => markup.replace(/srcDoc="[^"]*"/, 'srcDoc="…"');
const csp = (doc: string) => /Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1] ?? "";
const trusting = (...senders: string[]) => (qc: QueryClient) => {
  const me = qc.getQueryData(["me"]) as { user: typeof USER };
  qc.setQueryData(["me"], { ...me, user: { ...me.user, settings: { ...me.user.settings, imageSenders: senders } } });
};

const WITH_IMAGES = '<p>Hello</p><img src="https://cdn.sender.test/a.png"><img src="https://cdn.sender.test/b.png"><img src="https://track.other.test/p.gif"><img src="https://x.third.test/c.png">';

describe("the message frame, first paint", () => {
  it("is a quiet frame with a skeleton while it loads, and no notices when there is nothing to say", () => {
    const out = html(<HtmlBody html="<p>Hello Maya</p>" />);
    expect(shell(out)).toMatchSnapshot();
    expect(out).toContain("opacity-0");
    expect(out).not.toContain("not loaded");
    expect(out).not.toContain("tracker");
  });

  it("gives the frame a sandbox with no scripts, and a policy that holds back every other server's images", () => {
    const out = html(<HtmlBody html={WITH_IMAGES} />);
    expect(out).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(out).toContain('title="message"');
    expect(csp(srcdoc(out))).toBe("default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; img-src data: blob: 'self'");
    expect(srcdoc(out)).toContain('<meta name="referrer" content="no-referrer">');
    expect(srcdoc(out)).toContain(`<body>${WITH_IMAGES}</body>`);
  });

  it("says how many images were held back and from where, and offers to show them", () => {
    expect(shell(html(<HtmlBody html={WITH_IMAGES} />))).toMatchSnapshot();
  });
  it("offers 'Always for' the sender when it knows who sent the message", () => {
    const out = html(<HtmlBody html={WITH_IMAGES} sender=" Alex@Studio.test " />);
    expect(out).toContain("Always for alex@studio.test");
    expect(out).toContain("Show images");
  });
  it("says nothing about images when the message has none from other servers", () => {
    const out = html(<HtmlBody html='<p>Hi</p><img src="data:image/png;base64,AAAA">' />);
    expect(out).not.toContain("not loaded");
    expect(out).not.toContain("Show images");
  });

  it("lets a trusted sender's images through, says so, and offers to stop", () => {
    const out = html(<HtmlBody html={WITH_IMAGES} sender="alex@studio.test" />, "/", trusting("ALEX@studio.test"));
    expect(out).toContain("Images always shown for this sender");
    expect(out).toContain(">Stop<");
    expect(out).not.toContain("Show images");
    expect(csp(srcdoc(out))).toContain("img-src * data: blob:");
  });
  it("keeps holding back an untrusted sender's images when someone else is trusted", () => {
    const out = html(<HtmlBody html={WITH_IMAGES} sender="alex@studio.test" />, "/", trusting("someone@else.test"));
    expect(out).toContain("Show images");
    expect(csp(srcdoc(out))).toContain("img-src data: blob: 'self'");
  });

  it("lists the trackers that were blocked, two by name and the rest as a count", () => {
    const out = html(<HtmlBody html="<p>Hi</p>" trackers={["pixel", "track.sender.test", "tracker", "hidden-image"]} />);
    expect(shell(out)).toMatchSnapshot();
    expect(out).toContain("Blocked 4 trackers · Tiny hidden image, track.sender.test +2");
    expect(out).toContain('aria-label="4 trackers blocked. Show details"');
  });
  it("says tracker, not trackers, for one", () => {
    const out = html(<HtmlBody html="<p>Hi</p>" trackers={["tracker"]} />);
    expect(out).toContain("Blocked 1 tracker · Known tracker");
    expect(out).toContain('aria-label="1 tracker blocked. Show details"');
  });

  it("draws a message with no HTML as its text, kept as written, and ignores any markup in it", () => {
    const out = html(<HtmlBody html="" text={"Line one\nA <b>bold</b> claim"} />);
    expect(srcdoc(out)).toContain('<body><div style="white-space:pre-wrap">');
    expect(srcdoc(out)).toContain("Line one");
    expect(srcdoc(out)).not.toContain("<b>bold</b>");
  });
  it("draws the text when asked for plain, even if there is HTML", () => {
    const out = html(<HtmlBody html="<p>Rich</p>" text="Just text" plain />);
    expect(srcdoc(out)).toContain("Just text");
    expect(srcdoc(out)).not.toContain("<p>Rich</p>");
  });
  it("gives a plain message no notices about images", () => {
    expect(html(<HtmlBody html="" text="see https://cdn.sender.test/a.png" />)).not.toContain("not loaded");
  });

  it("takes the class it is given on its outer box", () => {
    expect(html(<HtmlBody html="<p>x</p>" className="mt-4" />)).toMatch(/^<div class="relative mt-4">/);
  });
});
