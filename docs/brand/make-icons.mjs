// Renders the Threshold icon set. Run from the repo root: node docs/brand/make-icons.mjs
// sharp is not a project dependency; point NODE_PATH at any node_modules that has it.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const mark = (c, sw) =>
  `<g transform="translate(-1)"><path d="M30 14A18 18 0 0 0 30 50Z" fill="${c}"/><path d="M36 14A18 18 0 0 1 36 50Z" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round"/></g>`;
const wrap = (b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${b}</svg>`;
// Small sizes get a heavier outline so the waiting half survives.
const tile = (sw) => wrap(`<rect width="64" height="64" rx="16" fill="#000"/>${mark("#fff", sw)}`);
const full = (scale) => wrap(`<rect width="64" height="64" fill="#000"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${mark("#fff", 4.5)}</g>`);

const out = [
  ["public/favicon.svg", tile(4.5)],
  ["public/logo.svg", tile(4.5)],
];
for (const [p, s] of out) writeFileSync(p, s);

const png = (svg, size, path) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(path);
await Promise.all([
  png(tile(6.5), 16, "apps/extension/icons/icon-16.png"),
  png(tile(5.5), 32, "apps/extension/icons/icon-32.png"),
  png(tile(4.5), 48, "apps/extension/icons/icon-48.png"),
  png(tile(4.5), 128, "apps/extension/icons/icon-128.png"),
  png(tile(5.5), 32, "public/favicon-32.png"),
  png(full(0.8), 180, "public/apple-touch-icon.png"),
  png(tile(4.5), 192, "public/icon-192.png"),
  png(tile(4.5), 512, "public/icon-512.png"),
  png(full(0.62), 512, "public/icon-maskable-512.png"),
]);
console.log("done");
