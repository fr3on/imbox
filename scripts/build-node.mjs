// Builds the API as one plain Node.js module. The migrations (.sql) are bundled as text.
//
//   node scripts/build-node.mjs      writes node-dist/api.js

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefines } from "./version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src/api/index.ts")],
  outfile: path.join(root, "node-dist/api.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  tsconfig: path.join(root, "tsconfig.api.json"),
  loader: { ".sql": "text" },
  // Which version, commit and build time this server reports (see src/shared/buildInfo.ts).
  define: buildDefines(),
  // Some dependencies still ask for require(); give the ES module one.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
