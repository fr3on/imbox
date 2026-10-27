// What a build says about itself: the version from package.json, the commit it was built from, and when. The web build (vite.config.ts), the server
// bundle (scripts/build-node.mjs) and the tests (vitest.config.ts) all read it here, so there is one place that decides, and nothing is written into the
// source tree (src/shared/buildInfo.ts reads the values). In a Docker build there is no .git folder, so the commit comes in as GIT_COMMIT.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Where this build's source lives. REPO_URL / REPO_LABEL (a build argument, like GIT_COMMIT) point the About dialog at another host, for example a GitLab.
const DEFAULT_REPO_URL = "https://github.com/fr3on/imbox";

export function buildInfo(env = process.env) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const repoUrl = (env.REPO_URL ?? "").trim().replace(/\/+$/, "").replace(/\.git$/, "") || DEFAULT_REPO_URL;
  const repoLabel = (env.REPO_LABEL ?? "").trim();
  let commit = (env.GIT_COMMIT ?? "").trim().slice(0, 7);
  if (!commit) {
    try {
      commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "unknown";
    }
  }
  return { version, commit, builtAt: env.BUILD_TIME || new Date().toISOString(), repoUrl, repoLabel };
}

/** The same values as compile-time constants, for a bundler's `define`. */
export function buildDefines(env = process.env) {
  const b = buildInfo(env);
  return {
    __APP_VERSION__: JSON.stringify(b.version),
    __APP_COMMIT__: JSON.stringify(b.commit),
    __APP_BUILT_AT__: JSON.stringify(b.builtAt),
    __APP_REPO_URL__: JSON.stringify(b.repoUrl),
    __APP_REPO_LABEL__: JSON.stringify(b.repoLabel),
  };
}
