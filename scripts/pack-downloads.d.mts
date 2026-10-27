export function crc32(buf: Uint8Array): number;
export function zipFiles(files: { name: string; data: Uint8Array | string }[]): Buffer;
export function readTree(dir: string): { name: string; data: Buffer }[];
export function buildId(files: { name: string; data: Uint8Array | string }[]): string;
