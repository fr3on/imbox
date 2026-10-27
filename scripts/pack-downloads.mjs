#!/usr/bin/env node
// Puts the files the apps page offers under public/downloads/, so the web build serves them from the server itself
// (the repository is private, so a link to a GitHub release would not open for a visitor).
//
//   imbox-extension.zip   the browser extension, packed from apps/extension on every build
//   imbox-mac.dmg         the Mac app, only when IMBOX_MAC_DMG names a built and signed .dmg (a build that is not signed must not be offered)
//   imbox-windows.exe     the Windows installer, when IMBOX_WIN_EXE names it
//   imbox-linux.AppImage  the Linux app, when IMBOX_LINUX_APPIMAGE names it (and imbox-linux.deb from IMBOX_LINUX_DEB)
//
// The zip is written here, without a zip program, so the Docker and CI builds need nothing extra, and the same files always give the same bytes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 2026-01-01 00:00, fixed so a rebuild of the same files is byte for byte the same.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/** A zip of `files` ([{ name, data }], names with forward slashes), in the order given. */
export function zipFiles(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(data);
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made on Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Every file under `dir`, sorted, as { name, data } with names relative to `dir`. Finder's .DS_Store files are left out. */
export function readTree(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === ".DS_Store") continue;
      if (entry.isDirectory()) walk(r);
      else if (entry.isFile()) out.push({ name: r, data: fs.readFileSync(path.join(dir, r)) });
    }
  };
  walk("");
  return out;
}

/**
 * Names this exact set of extension files, so an installed copy can tell whether the server holds a different build. The same files always give the
 * same id; a change to any file, its name included, gives another.
 */
export function buildId(files) {
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(f.name).update("\0").update(f.data).update("\0");
  return h.digest("hex").slice(0, 10);
}

// The desktop apps, each offered only when its environment variable names a built file.
const APPS = [
  ["IMBOX_MAC_DMG", "imbox-mac.dmg"],
  ["IMBOX_WIN_EXE", "imbox-windows.exe"],
  ["IMBOX_LINUX_APPIMAGE", "imbox-linux.AppImage"],
  ["IMBOX_LINUX_DEB", "imbox-linux.deb"],
];

function main() {
  const out = path.join(root, "public", "downloads");
  fs.mkdirSync(out, { recursive: true });

  const files = readTree(path.join(root, "apps", "extension"));
  if (!files.some((f) => f.name === "manifest.json")) throw new Error("apps/extension has no manifest.json; nothing to pack.");
  // build.json goes inside the zip and imbox-extension.json goes beside it: the extension compares its own copy with the server's.
  const info = { version: JSON.parse(Buffer.from(files.find((f) => f.name === "manifest.json").data).toString("utf8")).version, build: buildId(files) };
  files.push({ name: "build.json", data: JSON.stringify(info) });
  fs.writeFileSync(path.join(out, "imbox-extension.zip"), zipFiles(files));
  fs.writeFileSync(path.join(out, "imbox-extension.json"), JSON.stringify(info));
  console.log(`downloads: imbox-extension.zip (${files.length} files, build ${info.build})`);

  for (const [env, name] of APPS) {
    const src = process.env[env];
    const target = path.join(out, name);
    if (src) {
      if (!fs.existsSync(src)) throw new Error(`${env} names ${src}, which does not exist.`);
      fs.copyFileSync(src, target);
      console.log(`downloads: ${name}`);
    } else {
      // A file left over from an earlier build must not be offered by accident.
      fs.rmSync(target, { force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
