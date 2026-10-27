import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  baseStyle,
  contrastRatio,
  enhanceCautionBanners,
  enhanceGmailQuotes,
  enhanceMeetingInvites,
  enhanceSensitivityLabels,
  paintsOwnBackground,
  relightForDarkPage,
  trackerLabel,
  wrapOutlookQuotes,
} from "@/components/HtmlBody";

// The code that reads a message once it is in its frame: the colour arithmetic, the style the frame is given, and the parts that look through the message
// and fold its quoted history, mark its invites and quiet its banners. A message is parsed with linkedom here, which is a document with no browser around
// it; the real frame is a browser's. What these pin is what the code does to a document, which is the same.

const doc = (body: string) => parseHTML(`<!doctype html><html><head></head><body>${body}</body></html>`).document as unknown as Document;
const q = (d: Document, sel: string) => d.querySelector<HTMLElement>(sel);
/** Whitespace between tags is not part of what a reader sees. */
const tidy = (s: string) => s.replace(/\s*\n\s*/g, "").replace(/>\s+</g, "><");

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for the same colour twice", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });
  it("reads three-digit hex, rgb() and rgba() alike", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 5);
    expect(contrastRatio("rgba(0,0,0,1)", "#fff")).toBeCloseTo(21, 5);
  });
  it("lays a see-through colour over the background before measuring", () => {
    // Half black over white is the mid grey 127.5. Its channel is 0.5, so its luminance is ((0.5 + 0.055) / 1.055) ** 2.4 = 0.2140, and 1.05 / 0.264 = 3.977.
    expect(contrastRatio("rgba(0,0,0,0.5)", "#ffffff")).toBeCloseTo(3.977, 2);
  });
  it("gives the best ratio when a colour cannot be read, so nothing is repainted on a guess", () => {
    expect(contrastRatio("not a colour", "#fff")).toBe(21);
    expect(contrastRatio("#000", "")).toBe(21);
    expect(contrastRatio("rgb(1,2)", "#fff")).toBe(21);
  });
  it("puts the black that disappears on a dark page far below the 3 that relighting allows, and a mid blue above it", () => {
    expect(contrastRatio("#000000", "#191919")).toBeLessThan(1.3);
    expect(contrastRatio("#4a7fd4", "#191919")).toBeGreaterThan(3);
  });
});

describe("paintsOwnBackground", () => {
  it("is true for a background colour in a style, a shorthand, and the old bgcolor attribute", () => {
    expect(paintsOwnBackground('<td style="background-color:#f0f0f0">x</td>')).toBe(true);
    expect(paintsOwnBackground('<div style="background: #fff url(a.png)">x</div>')).toBe(true);
    expect(paintsOwnBackground('<table bgcolor="#eeeeee"><tr><td>x</td></tr></table>')).toBe(true);
    expect(paintsOwnBackground("<style>body{BACKGROUND-COLOR : red}</style>")).toBe(true);
  });
  it("is false when the background is transparent, inherited or none, and for a message that sets none", () => {
    expect(paintsOwnBackground('<td style="background-color:transparent">x</td>')).toBe(false);
    expect(paintsOwnBackground('<td style="background:inherit">x</td>')).toBe(false);
    expect(paintsOwnBackground('<td style="background:none;color:#000">x</td>')).toBe(false);
    expect(paintsOwnBackground("<p>hello</p>")).toBe(false);
  });
});

describe("trackerLabel", () => {
  it("names the three kinds the sanitiser records and passes a host through", () => {
    expect(trackerLabel("pixel")).toBe("Tiny hidden image");
    expect(trackerLabel("hidden-image")).toBe("Hidden image");
    expect(trackerLabel("tracker")).toBe("Known tracker");
    expect(trackerLabel("track.sender.test")).toBe("track.sender.test");
  });
});

describe("baseStyle", () => {
  const light = { dark: false, fg: "#111111", bg: "#fefefe", muted: "#666666", border: "#dddddd" };
  const dark = { dark: true, fg: "#eeeeee", bg: "#101010", muted: "#999999", border: "#333333" };
  it("follows the app theme for a plain message, in light and in dark", () => {
    expect(baseStyle(light, false)).toMatchSnapshot("light");
    expect(baseStyle(dark, false)).toMatchSnapshot("dark");
  });
  it("keeps the light canvas for a message that paints its own background, even on the dark page", () => {
    const s = baseStyle(dark, true);
    expect(s).toContain("html{color-scheme:light;}");
    expect(s).toContain("color:#37352f;word-wrap");
    expect(s).toMatchSnapshot("painted on dark");
  });
  it("sets the scheme from the page only when the message paints nothing", () => {
    expect(baseStyle(dark, false)).toContain("html{color-scheme:dark;}");
    expect(baseStyle(light, false)).toContain("html{color-scheme:light;}");
  });
});

describe("relightForDarkPage", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());
  /** A stand-in for the browser's computed colour: what an element names, or what it inherits. */
  const withColours = (d: Document) => {
    const colourOf = (el: Element | null): string => {
      if (!el) return "rgb(255, 255, 255)";
      const own = /(?:^|;)\s*color:\s*([^;]+)/.exec(el.getAttribute("style") ?? "");
      return own ? own[1].trim() : colourOf(el.parentElement);
    };
    (d.defaultView as unknown as { getComputedStyle: (el: Element) => { color: string } }).getComputedStyle = (el) => ({ color: colourOf(el) });
    // What is asked of the style, with its priority, which a bare document does not keep.
    const set: [string, string, string][] = [];
    const proto = Object.getPrototypeOf((d.body as HTMLElement).style) as { setProperty(this: unknown, name: string, value: string, priority?: string): void };
    const real = proto.setProperty;
    const patched = function (this: unknown, name: string, value: string, priority?: string) {
      set.push([name, value, priority ?? ""]);
      real.call(this, name, value, priority);
    };
    proto.setProperty = patched;
    restore = () => {
      proto.setProperty = real;
    };
    return set;
  };

  it("gives our text colour to an element whose own colour cannot be read on the page, and says how many", () => {
    const d = doc('<p id="a" style="color:#000000">black</p><p id="b" style="color:#4a7fd4">blue</p><p id="c">ours</p>');
    const set = withColours(d);
    expect(relightForDarkPage(d, "#191919", "#eeeeee")).toBe(1);
    expect(set).toEqual([["color", "#eeeeee", "important"]]);
    expect(q(d, "#a")?.getAttribute("style")).toContain("#eeeeee");
    expect(q(d, "#b")?.getAttribute("style")).toBe("color:#4a7fd4");
  });
  it("leaves a colour that is merely inherited, since it is already ours", () => {
    const d = doc('<div style="color:#4a7fd4"><span id="s">inside</span></div>');
    const set = withColours(d);
    expect(relightForDarkPage(d, "#191919", "#eeeeee")).toBe(0);
    expect(set).toEqual([]);
  });
  it("repaints a child that names a dark colour inside a readable parent", () => {
    const d = doc('<div style="color:#4a7fd4"><span id="s" style="color:#000">inside</span></div>');
    const set = withColours(d);
    expect(relightForDarkPage(d, "#191919", "#eeeeee")).toBe(1);
    expect(set).toEqual([["color", "#eeeeee", "important"]]);
    expect(q(d, "#s")?.getAttribute("style")).toContain("#eeeeee");
  });
  it("skips an element the browser gives no colour for", () => {
    const d = doc("<p>text</p>");
    (d.defaultView as unknown as { getComputedStyle: () => { color: string } }).getComputedStyle = () => ({ color: "" });
    expect(relightForDarkPage(d, "#191919", "#eeeeee")).toBe(0);
  });
});

describe("enhanceGmailQuotes", () => {
  // The sender it prints here is "Mon, Sep 29, 2026": the code cuts the line at the time, so a line that puts the date before the name loses the name.
  // That is what it does today, and it is pinned as it is; it is not a thing this change touches.
  it("hides a quote behind a fold bar, and hides the line that introduced it", () => {
    const d = doc('<p>Thanks!</p><div id="intro">On Mon, Sep 29, 2026 at 10:15 AM Alex Rivera &lt;alex@studio.test&gt; wrote:</div><blockquote id="q"><p>Can we move it?</p></blockquote>');
    enhanceGmailQuotes(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
    expect(q(d, "#intro")?.getAttribute("style")).toContain("display");
    expect(q(d, "#q")?.classList.contains("imbox-quoted-hidden")).toBe(true);
  });
  it("says Forwarded for a forwarded message, and Quoted otherwise", () => {
    const d = doc("<blockquote>---------- Forwarded message ---------<br>From: Alex</blockquote><blockquote>plain</blockquote>");
    enhanceGmailQuotes(d);
    const actions = Array.from(d.querySelectorAll(".inline-fold-btn")).map((b) => b.getAttribute("data-action"));
    expect(actions).toEqual(["Forwarded", "Quoted"]);
  });
  it("names no one when there is no introduction, and folds a gmail_quote div as well", () => {
    const d = doc('<div class="gmail_quote">earlier</div>');
    enhanceGmailQuotes(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("uses the address when the introduction has no name, and escapes what it prints", () => {
    const d = doc('<p>On at 10:15 &lt;a&amp;b@x.test&gt; wrote:</p><blockquote>q</blockquote>');
    enhanceGmailQuotes(d);
    const btn = q(d, ".inline-fold-btn");
    expect(btn?.getAttribute("data-sender")).toBe("a&b@x.test");
    expect(btn?.innerHTML).toContain("from a&amp;b@x.test");
  });
  it("reads the weekday as the name when the line has a time but no name, which is what it does today", () => {
    const d = doc("<p>On Mon at 10:15 &lt;alex@studio.test&gt; wrote:</p><blockquote>q</blockquote>");
    enhanceGmailQuotes(d);
    expect(q(d, ".inline-fold-btn")?.getAttribute("data-sender")).toBe("Mon");
  });
  it("does not fold the same quote twice, nor one inside an Outlook fold", () => {
    const d = doc("<blockquote>q</blockquote>");
    enhanceGmailQuotes(d);
    enhanceGmailQuotes(d);
    expect(d.querySelectorAll(".inline-fold-bar")).toHaveLength(1);
    const o = doc('<div class="outlook-quoted"><blockquote>inner</blockquote></div>');
    enhanceGmailQuotes(o);
    expect(o.querySelectorAll(".inline-fold-bar")).toHaveLength(0);
  });
});

describe("wrapOutlookQuotes", () => {
  it("wraps from the web-app reply block to the end, with a fold bar that names the sender and the time", () => {
    const d = doc('<p>Sounds good.</p><div id="divRplyFwdMsg"><b>From:</b> Alex Rivera &lt;alex@studio.test&gt;<br>\n<b>Sent:</b> Monday, September 29, 2026 10:15 AM<br>\n<b>To:</b> Maya</div><p>Old text</p>');
    wrapOutlookQuotes(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("finds a classic From/Sent/To header and a dashed Original Message line", () => {
    const a = doc("<p>Reply</p><p>From: Alex Rivera [mailto:alex@studio.test]<br>\nSent: Tuesday, 30 September 2026 09:00<br>\nTo: Maya<br>\nSubject: Plan</p><p>Old</p>");
    wrapOutlookQuotes(a);
    expect(tidy(a.body.innerHTML)).toMatchSnapshot("from-sent-to");
    const b = doc("<p>Reply</p><p>-----Original Message-----</p><p>Old</p>");
    wrapOutlookQuotes(b);
    expect(tidy(b.body.innerHTML)).toMatchSnapshot("original-message");
  });
  it("finds an unquoted 'On ... wrote:' line (the name is cut at the time, as for Gmail)", () => {
    const d = doc("<p>Reply</p><div>On Mon, Sep 29, 2026 at 10:15 AM Alex Rivera wrote:</div><div>Old text</div>");
    wrapOutlookQuotes(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("includes a rule just above the header, and says Forwarded when the text says so", () => {
    const d = doc('<p>FYI</p><hr><div id="divRplyFwdMsg">From: Alex<br>\nSent: Monday 10:15 AM</div><p>---------- Forwarded message ----------</p>');
    wrapOutlookQuotes(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("reads headers in other languages", () => {
    const d = doc('<p>Antwort</p><div id="divRplyFwdMsg">Von: Alex Rivera &lt;alex@studio.test&gt;<br>\nGesendet: Montag 10:15</div><p>Alt</p>');
    wrapOutlookQuotes(d);
    expect(q(d, ".inline-fold-btn")?.getAttribute("data-sender")).toBe("Alex Rivera");
    expect(q(d, ".fold-badge")?.textContent).toBe("10:15");
  });
  it("leaves a message with no such header untouched, and one already wrapped", () => {
    const plain = "<p>Hello</p><p>Nothing quoted here</p>";
    const a = doc(plain);
    wrapOutlookQuotes(a);
    expect(a.body.innerHTML).toBe(plain);
    const b = doc('<p>x</p><div id="divRplyFwdMsg">From: Alex<br>\nSent: Monday 10:15 AM</div><p>old</p>');
    wrapOutlookQuotes(b);
    const once = b.body.innerHTML;
    wrapOutlookQuotes(b);
    expect(b.body.innerHTML).toBe(once);
  });
});

describe("enhanceMeetingInvites", () => {
  it("turns a Teams invite into a strip with the id, passcode and a join link, and the device details folded", () => {
    const d = doc(
      '<p>Agenda</p><div id="inv"><p>Microsoft Teams meeting</p><a href="https://teams.microsoft.com/l/meetup-join/abc">Join</a><p>Meeting ID: 123 456 789 01</p>\n<p>Passcode: Ab3dEf</p>\n<p>Tenant key: tk-1</p>\n<p>Video ID: 998 877 66</p></div>',
    );
    enhanceMeetingInvites(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("makes a Zoom strip from the meeting link, taking the passcode from the text", () => {
    const d = doc('<p>Join</p><div><a href="https://acme.zoom.us/j/8123456789">Join Zoom</a><p>Passcode: z00mPass</p></div>');
    enhanceMeetingInvites(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("makes a Meet strip with the meeting code", () => {
    const d = doc('<div><a href="https://meet.google.com/abc-defg-hij">Join with Google Meet</a></div>');
    enhanceMeetingInvites(d);
    expect(tidy(d.body.innerHTML)).toMatchSnapshot();
  });
  it("leaves a message with no meeting link alone, and a link already inside a strip", () => {
    const a = doc("<p>No links</p>");
    enhanceMeetingInvites(a);
    expect(a.body.innerHTML).toBe("<p>No links</p>");
    const b = doc('<div class="strip-bar"><a href="https://meet.google.com/abc-defg-hij">x</a></div>');
    enhanceMeetingInvites(b);
    expect(b.querySelectorAll(".strip-bar")).toHaveLength(1);
  });
  it("lifts a strip out of the quoted history, above its fold bar, so it is not hidden with it", () => {
    const d = doc(
      '<p>Reply</p><div class="inline-fold-bar"><button class="inline-fold-btn">x</button></div><blockquote class="imbox-quoted-hidden"><div><a href="https://meet.google.com/abc-defg-hij">Join</a></div></blockquote>',
    );
    enhanceMeetingInvites(d);
    const kids = Array.from(d.body.children).map((c) => c.className || c.tagName);
    expect(kids).toEqual(["P", "strip-bar", "inline-fold-bar", "imbox-quoted-hidden"]);
  });
});

describe("enhanceCautionBanners and enhanceSensitivityLabels", () => {
  it("marks the outermost box that holds only an external-sender warning, and only the first", () => {
    const d = doc(
      '<div id="o"><div id="m"><p>CAUTION: This email originated from outside the organization. Do not click links.</p></div></div><p>Body</p><p>External email: Use caution</p>',
    );
    enhanceCautionBanners(d);
    expect(Array.from(d.querySelectorAll(".caution-banner-subtle")).map((e) => e.id || e.tagName)).toEqual(["o"]);
  });
  it("does not mark a long message that mentions it", () => {
    const d = doc(`<p>CAUTION: This email originated from outside. ${"word ".repeat(80)}</p>`);
    enhanceCautionBanners(d);
    expect(d.querySelectorAll(".caution-banner-subtle")).toHaveLength(0);
  });
  it("marks a short classification line as a label, the first one only", () => {
    const d = doc("<p>Hello</p><p>Classification: Internal</p><p>Sensitivity: Public</p>");
    enhanceSensitivityLabels(d);
    const marked = Array.from(d.querySelectorAll(".email-sensitivity-label")).map((e) => e.textContent);
    expect(marked).toEqual(["Classification: Internal"]);
  });
  it("ignores a line that is long or that does not begin with a label", () => {
    const d = doc(`<p>Today's classification: none</p><p>Sensitivity: ${"x".repeat(60)}</p>`);
    enhanceSensitivityLabels(d);
    expect(d.querySelectorAll(".email-sensitivity-label")).toHaveLength(0);
  });
});
