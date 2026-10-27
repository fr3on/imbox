import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. Pack desktop/extension downloads
const pack = spawn(process.execPath, ["scripts/pack-downloads.mjs"], { cwd: root, stdio: "inherit" });

pack.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  // 2. Start Vite
  const vite = spawn("npx", ["vite"], { cwd: root, stdio: "inherit", shell: true });

  const shutdown = () => {
    try {
      vite.kill();
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  vite.on("exit", shutdown);
});
