import { describe, expect, it } from "vitest";
import type { SystemInfo } from "@shared/types";
import { serverHealth } from "@/lib/serverHealth";
import { ServerSection } from "@/settings/server/ServerSection";
import { html, NOW } from "./render";

// The Server tab: a health line on top, then Usage, Specs, Imbox and Database as folded sections that say what is inside.

const GB = 1024 ** 3;
const info = (over: { cpu?: number; mem?: number; disk?: number | null } = {}): SystemInfo => ({
  app: { version: "0.1.0", commit: "a1b2c3d", built_at: new Date(NOW - 86_400_000).toISOString(), started_at: NOW - 3 * 86_400_000 },
  host: {
    os: "Linux 6.8.0",
    arch: "x64",
    hostname: "lab",
    node: "v22.11.0",
    cpu_model: "Intel Xeon",
    cpu_cores: 104,
    cpu_percent: over.cpu ?? 14,
    load: [1, 2, 3],
    memory_total: 62 * GB,
    memory_used: Math.round(((over.mem ?? 37) / 100) * 62 * GB),
    memory_limited: false,
    disk_total: over.disk === null ? null : 1000 * GB,
    disk_used: over.disk === null ? null : Math.round(((over.disk ?? 22) / 100) * 1000 * GB),
    host_uptime_s: 3 * 86_400,
    process: { rss: 200 * 1024 ** 2, heap_used: 1, uptime_s: 3 * 86_400, pid: 1 },
  },
  database: { version: "16.4", bytes: 1.2 * GB, tables: [{ name: "messages", bytes: 840 * 1024 ** 2, rows: 91_204 }] },
  checked_at: NOW,
});
const render = (s: SystemInfo) => html(<ServerSection />, "/settings/server", (qc) => qc.setQueryData(["system"], s));

describe("server health", () => {
  it("is healthy with room to spare, and says how much is used", () => {
    const h = serverHealth(info());
    expect(h.ok).toBe(true);
    expect(h.line).toBe("Memory 37%, disk 22%, database 1.2 GB. Nothing needs attention.");
  });

  it("names what is too full", () => {
    const h = serverHealth(info({ mem: 93, disk: 95 }));
    expect(h.ok).toBe(false);
    expect(h.issues).toEqual(["Memory 93% used", "Disk 95% full"]);
    expect(h.line).toBe("Memory 93% used, Disk 95% full.");
  });

  it("flags a busy processor and leaves out a disk it cannot read", () => {
    expect(serverHealth(info({ cpu: 97 })).issues).toEqual(["Processor 97% busy"]);
    expect(serverHealth(info({ disk: null })).line).toBe("Memory 37%, database 1.2 GB. Nothing needs attention.");
  });
});

describe("the Server tab", () => {
  it("shows Healthy and a summary on each folded section", () => {
    const out = render(info());
    expect(out).toContain("Healthy");
    expect(out).toContain("Nothing needs attention.");
    expect(out).toContain("Processor 14% · memory 23 GB of 62 GB");
    expect(out).toContain("Linux · 104 cores · 62 GB");
    expect(out).toContain("0.1.0 · up 3 days 0 hours");
    expect(out).toContain("PostgreSQL 16.4 · 1.2 GB");
    expect(out).toContain("Refresh");
    expect(out).not.toContain("Load 1, 2, 3");
  });

  it("opens Usage and says what needs attention when something is too full", () => {
    const out = render(info({ mem: 93 }));
    expect(out).toContain("Needs attention");
    expect(out).toContain("Memory 93% used.");
    expect(out).toContain("Load 1, 2, 3 over 1, 5 and 15 minutes");
  });
});
