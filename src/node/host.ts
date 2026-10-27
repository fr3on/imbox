// What the machine running Imbox is and how busy it is, for Settings > Server. Node only: it reads the operating system, the cgroup limits a
// container sets, and the disk the app writes to.
import fs from "node:fs";
import os from "node:os";

export interface HostInfo {
  os: string;
  arch: string;
  hostname: string;
  node: string;
  cpu_model: string;
  cpu_cores: number;
  /** Share of the CPU in use over a short sample, 0 to 100. */
  cpu_percent: number;
  load: [number, number, number];
  memory_total: number;
  memory_used: number;
  /** Set when a container caps memory below what the machine has. Memory figures above are then the container's. */
  memory_limited: boolean;
  disk_total: number | null;
  disk_used: number | null;
  host_uptime_s: number;
  process: { rss: number; heap_used: number; uptime_s: number; pid: number };
}

const num = (s: string): number | null => {
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};
const read = (p: string): string | null => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

/** The memory a container is held to and uses, from cgroup v2 or v1; null when there is no cap (or no cgroup). */
function cgroupMemory(): { limit: number; used: number } | null {
  const v2 = read("/sys/fs/cgroup/memory.max");
  const v1 = read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const limit = v2 !== null ? num(v2) : v1 !== null ? num(v1) : null;
  if (limit === null || limit <= 0 || limit >= os.totalmem()) return null;
  const cur = read("/sys/fs/cgroup/memory.current") ?? read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const used = cur === null ? null : num(cur);
  return used === null ? null : { limit, used };
}

/** Memory the system can still hand out. Linux counts cache as free in MemAvailable, which os.freemem() does not, so a busy file cache would read as a full machine. */
function memoryAvailable(): number {
  const m = /^MemAvailable:\s+(\d+) kB/m.exec(read("/proc/meminfo") ?? "");
  return m ? Number(m[1]) * 1024 : os.freemem();
}

const ticks = () =>
  os.cpus().reduce(
    (a, c) => {
      const t = c.times;
      return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq };
    },
    { idle: 0, total: 0 },
  );

/** CPU in use across all cores between two readings a moment apart. */
async function cpuPercent(sampleMs = 250): Promise<number> {
  const a = ticks();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = ticks();
  const total = b.total - a.total;
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - (b.idle - a.idle) / total) * 100))) : 0;
}

async function disk(): Promise<{ total: number; used: number } | null> {
  try {
    const s = await fs.promises.statfs(process.cwd());
    const total = s.blocks * s.bsize;
    return { total, used: total - s.bfree * s.bsize };
  } catch {
    return null;
  }
}

export async function hostInfo(): Promise<HostInfo> {
  const [cpu, d] = await Promise.all([cpuPercent(), disk()]);
  const cg = cgroupMemory();
  const [l1, l5, l15] = os.loadavg();
  const mem = process.memoryUsage();
  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    hostname: os.hostname(),
    node: process.version,
    cpu_model: (os.cpus()[0]?.model ?? "unknown").replace(/\s+/g, " ").trim(),
    cpu_cores: os.availableParallelism?.() ?? os.cpus().length,
    cpu_percent: cpu,
    load: [l1, l5, l15].map((x) => Math.round(x * 100) / 100) as [number, number, number],
    memory_total: cg ? cg.limit : os.totalmem(),
    memory_used: cg ? cg.used : os.totalmem() - memoryAvailable(),
    memory_limited: !!cg,
    disk_total: d?.total ?? null,
    disk_used: d?.used ?? null,
    host_uptime_s: Math.round(os.uptime()),
    process: { rss: mem.rss, heap_used: mem.heapUsed, uptime_s: Math.round(process.uptime()), pid: process.pid },
  };
}
