#!/usr/bin/env node
// The two checks a release depends on, run by .github/workflows/release.yml and usable by hand.
//   node scripts/release.mjs check v0.2.0     the tag, package.json, the extension manifest and CHANGELOG.md all agree
//   node scripts/release.mjs notes 0.2.0      prints that version's section of CHANGELOG.md (it becomes the release notes)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** The text under `## [version]` in a changelog, up to the next version heading; null when there is no such section. */
export function sectionOf(changelog, version) {
  const lines = changelog.split("\n");
  const head = (l) => /^## \[/.test(l);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && head(l));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** Everything wrong with cutting `tag` (for example "v0.2.0") from the files given. An empty list means go ahead. */
export function problemsWith(tag, files) {
  const out = [];
  const m = /^v(.+)$/.exec(tag);
  if (!m || !SEMVER.test(m[1])) return [`The tag "${tag}" is not a version like v1.2.3 or v1.2.3-rc.1.`];
  const version = m[1];
  const [, major, minor, patch] = SEMVER.exec(version);
  if (files.packageVersion !== version) out.push(`package.json says ${files.packageVersion}, the tag says ${version}.`);
  const numeric = `${major}.${minor}.${patch}`;
  if (files.manifestVersion !== numeric) out.push(`apps/extension/manifest.json says ${files.manifestVersion}, it has to be ${numeric} (a browser takes no pre-release suffix).`);
  const notes = sectionOf(files.changelog, version);
  if (notes === null) out.push(`CHANGELOG.md has no "## [${version}]" section.`);
  else if (!notes.replace(/<!--.*?-->/gs, "").trim()) out.push(`The "## [${version}]" section of CHANGELOG.md is empty.`);
  return out;
}

function readFiles() {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  return { packageVersion: JSON.parse(read("package.json")).version, manifestVersion: JSON.parse(read("apps/extension/manifest.json")).version, changelog: read("CHANGELOG.md") };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "check" && arg) {
    const problems = problemsWith(arg, readFiles());
    if (problems.length) {
      for (const p of problems) console.error(`- ${p}`);
      process.exit(1);
    }
    console.log(`${arg} is consistent.`);
  } else if (cmd === "notes" && arg) {
    const notes = sectionOf(readFiles().changelog, arg.replace(/^v/, ""));
    if (notes === null) {
      console.error(`CHANGELOG.md has no section for ${arg}.`);
      process.exit(1);
    }
    console.log(notes);
  } else {
    console.error("Usage: node scripts/release.mjs check <tag> | notes <version>");
    process.exit(2);
  }
}
