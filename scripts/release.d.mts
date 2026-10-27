export function sectionOf(changelog: string, version: string): string | null;
export function problemsWith(tag: string, files: { packageVersion: string; manifestVersion: string; changelog: string }): string[];
