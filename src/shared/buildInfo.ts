// Which build this is. (This replaces src/shared/version.ts, whose values were written by hand; nothing imports that file now.) The three values are put in at build time (scripts/version.mjs, through the bundler's `define`), so nothing here is edited or committed
// per release: the version comes from package.json, the commit from git or the GIT_COMMIT build argument, and the time from the build.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
export const COMMIT: string = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "dev";
export const BUILT_AT: string = typeof __APP_BUILT_AT__ === "string" ? __APP_BUILT_AT__ : "1970-01-01T00:00:00.000Z";

// Where the source lives (the REPO_URL / REPO_LABEL build arguments; GitHub when unset).
declare const __APP_REPO_URL__: string;
declare const __APP_REPO_LABEL__: string;
export const REPO_URL: string = typeof __APP_REPO_URL__ === "string" && __APP_REPO_URL__ ? __APP_REPO_URL__ : "https://github.com/fr3on/imbox";
const repoHost = (() => {
  try {
    return new URL(REPO_URL).hostname;
  } catch {
    return "";
  }
})();
/** Only a GitHub repository can be asked for its newest release (that is the one API the update check speaks). */
export const REPO_IS_GITHUB: boolean = repoHost === "github.com";
/** What the repository link is called in the About dialog. */
export const REPO_LABEL: string = (typeof __APP_REPO_LABEL__ === "string" && __APP_REPO_LABEL__) || (REPO_IS_GITHUB ? "GitHub" : repoHost.startsWith("gitlab.") ? "GitLab" : "Source code");
