import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The side panel refreshes itself every minute and keeps its search box and list across refreshes. A listener added to one of those elements
// every time it draws piles up, and then one click opens one tab per refresh. So the panel sets its handlers as properties, which replace the last.

const src = fs.readFileSync(path.resolve(__dirname, "../../apps/extension/popup.js"), "utf8");

describe("the extension panel", () => {
  it("adds no listener to anything it keeps across refreshes", () => {
    const adds = [...src.matchAll(/(\S+)\.addEventListener\(\s*"([a-z]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    // Fine: the page-level "came back into view", set once when the script loads; and the About card's own, on an element and a key listener that are made
    // and removed each time the card is opened.
    expect(adds).toEqual(["scrim click", "document keydown", "document visibilitychange"]);
    expect(src).toMatch(/document\.removeEventListener\("keydown", onKey, true\)/);
  });

  it("sets the click handler for the list as a property, so a refresh replaces it", () => {
    expect(src).toMatch(/body\.onclick = async \(e\)/);
    expect(src).toMatch(/find\.onsubmit = /);
  });
});
