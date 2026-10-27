import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildId, crc32, readTree, zipFiles } from "../../scripts/pack-downloads.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Reads a zip back through its central directory, the way an unzip program does. */
function unzip(buf: Buffer) {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer; crcOk: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + csize));
    expect(data.length).toBe(usize);
    out.push({ name, data, crcOk: crc32(data) === crc });
    p += 46 + nameLen;
  }
  return out;
}

describe("pack-downloads", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("writes a zip whose entries read back exactly, with good checksums", () => {
    const files = [
      { name: "manifest.json", data: '{"name":"imbox"}' },
      { name: "icons/icon-16.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]) },
      { name: "café.txt", data: "x".repeat(5000) },
      { name: "empty.txt", data: "" },
    ];
    const back = unzip(zipFiles(files));
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    back.forEach((f, i) => {
      expect(f.data.equals(Buffer.from(files[i].data))).toBe(true);
      expect(f.crcOk).toBe(true);
    });
  });

  it("gives the same bytes for the same files", () => {
    const files = [{ name: "a.txt", data: "one" }, { name: "b/c.txt", data: "two" }];
    expect(zipFiles(files).equals(zipFiles(files))).toBe(true);
  });

  it("packs the real extension, manifest included, without Finder's .DS_Store", () => {
    const tree = readTree(path.join(root, "apps", "extension"));
    const names = tree.map((f) => f.name);
    expect(names).toContain("manifest.json");
    expect(names.some((n) => n.endsWith(".DS_Store"))).toBe(false);
    const back = unzip(zipFiles(tree));
    expect(back.length).toBe(tree.length);
    expect(back.every((f) => f.crcOk)).toBe(true);
    expect(JSON.parse(back.find((f) => f.name === "manifest.json")!.data.toString()).name).toBeTruthy();
  });

  it("names a set of files so a change to any of them, or to a name, gives another id", () => {
    const a = [{ name: "popup.js", data: "one" }, { name: "lib.js", data: "two" }];
    expect(buildId(a)).toMatch(/^[0-9a-f]{10}$/);
    expect(buildId(a)).toBe(buildId([...a]));
    expect(buildId([{ name: "popup.js", data: "one!" }, a[1]])).not.toBe(buildId(a));
    expect(buildId([{ name: "popup2.js", data: "one" }, a[1]])).not.toBe(buildId(a));
  });
});
