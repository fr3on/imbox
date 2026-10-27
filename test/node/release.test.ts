import { describe, expect, it } from "vitest";
import { problemsWith, sectionOf } from "../../scripts/release.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-11-01

### Added
- Something new.

## [0.2.0-rc.1] - 2026-10-20

- A candidate.

## [0.1.0] - 2026-10-01

- The first.
`;

describe("sectionOf", () => {
  it("returns one version's text and stops at the next heading", () => {
    expect(sectionOf(CHANGELOG, "0.2.0")).toBe("### Added\n- Something new.");
    expect(sectionOf(CHANGELOG, "0.1.0")).toBe("- The first.");
  });
  it("tells a release candidate from the release", () => {
    expect(sectionOf(CHANGELOG, "0.2.0-rc.1")).toBe("- A candidate.");
  });
  it("is null for a version that has no section", () => {
    expect(sectionOf(CHANGELOG, "9.9.9")).toBeNull();
  });
});

describe("problemsWith", () => {
  const good = { packageVersion: "0.2.0", manifestVersion: "0.2.0", changelog: CHANGELOG };
  it("finds nothing wrong with a tag that matches everything", () => {
    expect(problemsWith("v0.2.0", good)).toEqual([]);
  });
  it("refuses a tag that is not a version", () => {
    expect(problemsWith("0.2.0", good)).toHaveLength(1);
    expect(problemsWith("vnext", good)).toHaveLength(1);
  });
  it("names each file that disagrees", () => {
    const p = problemsWith("v0.3.0", good);
    expect(p.join(" ")).toContain("package.json says 0.2.0");
    expect(p.join(" ")).toContain("apps/extension/manifest.json says 0.2.0");
    expect(p.join(" ")).toContain('no "## [0.3.0]" section');
  });
  it("lets a release candidate keep a plain version in the extension", () => {
    expect(problemsWith("v0.2.0-rc.1", { ...good, packageVersion: "0.2.0-rc.1" })).toEqual([]);
  });
  it("refuses an empty section", () => {
    expect(problemsWith("v0.1.0", { ...good, packageVersion: "0.1.0", manifestVersion: "0.1.0", changelog: "## [0.1.0]\n\n<!-- later -->\n\n## [0.0.1]\nx" })[0]).toContain("empty");
  });
});
