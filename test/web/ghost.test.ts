import { describe, expect, it } from "vitest";
import { askable, plainContext, plainText, spaced, stripGhost } from "@/components/Composer/ghost";

// The grey words that finish a sentence in a reply. The caret handling needs a real page; these are the parts that do not.

describe("stripGhost", () => {
  it("takes the suggestion out of the body before it is saved or sent", () => {
    const html = 'Thanks, I will<span data-ghost="1" contenteditable="false" class="text-tertiary" title="Tab to add"> send it today.</span><br>Ahmed';
    expect(stripGhost(html)).toBe("Thanks, I will<br>Ahmed");
  });

  it("leaves a body without one as it is", () => {
    expect(stripGhost("<p>Hello <b>there</b></p>")).toBe("<p>Hello <b>there</b></p>");
  });
});

describe("askable", () => {
  it("waits for something to go on", () => {
    expect(askable("Hi")).toBe(false);
    expect(askable("Dear Ram")).toBe(true);
    expect(askable("Thanks for sending this over")).toBe(true);
  });

  it("does not ask right after a line break", () => {
    expect(askable("Thanks for sending this over.\n")).toBe(false);
  });
});

describe("spaced", () => {
  it("puts a space between words", () => {
    expect(spaced("I will", "send it")).toBe(" send it");
  });

  it("adds no second space", () => {
    expect(spaced("I will ", "send it")).toBe("send it");
    expect(spaced("I will", "  send it")).toBe(" send it");
  });

  it("joins punctuation to the word before it", () => {
    expect(spaced("I will do it", ", thanks.")).toBe(", thanks.");
    expect(spaced("Is that fine", "?")).toBe("?");
  });

  it("gives nothing for nothing", () => {
    expect(spaced("I will", "   ")).toBe("");
  });
});

describe("plainText", () => {
  it("breaks lines where blocks end and drops tags and entities", () => {
    expect(plainText("<div>Dear Maya,</div><div><br></div><div>Not now &amp; later</div>")).toBe("Dear Maya,\n\nNot now & later");
  });

  it("ignores styles", () => {
    expect(plainText("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi");
  });

  it("keeps the start of the email being answered, which is its newest message", () => {
    const out = plainContext(`<p>Newest first.</p><p>${"older ".repeat(500)}</p>`, 100);
    expect(out.startsWith("Newest first.")).toBe(true);
    expect(out.length).toBe(100);
  });
});
