import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FLOWS, allowlist } from "../../src/shared/privacy";

// The privacy page lists every outside address the app can contact, and says a test keeps that list honest. This is that test: it reads the code for
// every web address written in it. An address that is not on the page and not named below as only a link or a name fails, and so does a page entry that
// no code uses any more. To add a place the app contacts, add it to src/shared/privacy.ts. To add a link, add its host to LINKS with the reason.

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["src", "server", "apps/extension", "apps/desktop/ui", "apps/desktop/src-tauri/src", "public/sw.js", "index.html"];
const SKIP_FILES = new Set([path.join(ROOT, "src/shared/privacy.ts")]);
const EXT = /\.(ts|tsx|mjs|js|html|rs|json)$/;

/** Hosts that appear in the code but are never contacted by the app: a page the person is sent to, an XML namespace, or an example in the text. */
const LINKS: Record<string, string> = {
  "github.com": "links to the project and its releases page, opened by the person",
  "imbox.lol": "a link to the project documentation, opened by the person",
  "myaccount.google.com": "a link in the setup help",
  "console.cloud.google.com": "a link in the setup help",
  "portal.azure.com": "a link in the setup help",
  "entra.microsoft.com": "a link in the setup help",
  "appleid.apple.com": "a link in the calendar setup help",
  "apple.com": "a link in the calendar setup help",
  "stalw.art": "a link to the Stalwart documentation",
  "calendarserver.org": "an XML namespace in CalDAV requests, not an address",
  "platform.openai.com": "a link to where a key is made",
  "console.anthropic.com": "a link to where a key is made",
  "console.x.ai": "a link to where a key is made",
  "aistudio.google.com": "a link to where a key is made",
  "console.typesafe.ai": "a link to where a key is made",
  "typesafe.ai": "a link to their privacy policy",
  "console.groq.com": "a link to where a key is made",
  "api.together.ai": "a link to where a key is made",
  "app.fireworks.ai": "a link to where a key is made",
  "cloud.cerebras.ai": "a link to where a key is made",
  "platform.deepseek.com": "a link to where a key is made",
  "console.mistral.ai": "a link to where a key is made",
  "console.aws.amazon.com": "a link to where a key is made",
  "schema.org": "a vocabulary name in page metadata",
};

const files = (p: string): string[] => {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name === "target" || e.name === "dist") return [];
    const child = path.join(p, e.name);
    return e.isDirectory() ? files(child) : EXT.test(e.name) ? [path.join(ROOT, child)] : [];
  });
};

/** Every host written as https:// or http:// in the code, with the file that has it. Examples, tests and this machine are not outside addresses. */
function hostsInCode(): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of DIRS.flatMap(files)) {
    if (SKIP_FILES.has(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\bhttps?:\/\/([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])/g)) {
      const host = m[1].toLowerCase();
      if (/(^|\.)(example(\.(com|org|net))?|test|invalid|localhost|local)$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes(".")) continue;
      if (/\.(js|ts|tsx|css|png|svg|json|md)$/.test(host)) continue;
      if (!found.has(host)) found.set(host, path.relative(ROOT, f));
    }
  }
  return found;
}

const page = new Set(FLOWS.flatMap((f) => f.hosts));
/** `*.googleusercontent.com` on the page covers lh3.googleusercontent.com in the code. */
const onPage = (host: string) => page.has(host) || [...page].some((p) => p.startsWith("*.") && host.endsWith(p.slice(1)));

describe("the privacy page", () => {
  const code = hostsInCode();

  it("lists every outside address the code can contact", () => {
    const missing = [...code].filter(([h]) => !onPage(h) && !(h in LINKS)).map(([h, f]) => `${h} (${f})`);
    expect(missing, "an address in the code that the privacy page does not list: add it to FLOWS in src/shared/privacy.ts, or to LINKS here if it is only a link").toEqual([]);
  });

  it("lists nothing the code no longer uses", () => {
    // A wildcard stands for addresses the provider hands out at run time, so the code never writes them.
    const stale = [...page].filter((p) => !p.startsWith("*.") && !code.has(p));
    expect(stale).toEqual([]);
  });

  it("keeps LINKS to hosts that are still in the code", () => {
    expect(Object.keys(LINKS).filter((h) => !code.has(h))).toEqual([]);
  });

  it("gives every flow a reason, what is seen, and how to stop it, and is dated", () => {
    for (const f of FLOWS) for (const k of ["title", "who", "sees", "why", "stop"] as const) expect(f[k].trim(), `${f.id}.${k}`).not.toBe("");
    expect(new Set(FLOWS.map((f) => f.id)).size).toBe(FLOWS.length);
  });

  it("writes the allowlist with each group's heading, in two blocks", () => {
    const text = allowlist(FLOWS);
    expect(text.startsWith("# On its own\n")).toBe(true);
    expect(text).toContain("\n\n# Only if you connect or turn it on\n");
    for (const h of page) expect(text).toContain(h);
  });
});
