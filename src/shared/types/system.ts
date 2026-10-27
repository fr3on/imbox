/** What GET /api/system answers: the machine, the app and the database it runs on. */
export interface SystemInfo {
  app: { version: string; commit: string; built_at: string; started_at: number };
  host: {
    os: string;
    arch: string;
    hostname: string;
    node: string;
    cpu_model: string;
    cpu_cores: number;
    cpu_percent: number;
    load: [number, number, number];
    memory_total: number;
    memory_used: number;
    memory_limited: boolean;
    disk_total: number | null;
    disk_used: number | null;
    host_uptime_s: number;
    process: { rss: number; heap_used: number; uptime_s: number; pid: number };
  };
  database: { version: string; bytes: number; tables: { name: string; bytes: number; rows: number }[] };
  checked_at: number;
}
