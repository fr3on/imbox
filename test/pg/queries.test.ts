import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../server/pggateway.mjs";
import { numberPlaceholders } from "../../server/sql.mjs";

const URL = process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test";
const root = path.resolve(__dirname, "../../src/api");
const migDir = path.resolve(__dirname, "../../migrations");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

/** Every SQL string passed to .prepare(...) in the Worker: template literals (with their ${...} holes) and plain strings. */
function extract(): { file: string; sql: string; dynamic: boolean }[] {
  const out: { file: string; sql: string; dynamic: boolean }[] = [];
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf8");
    const re = /\.prepare\(\s*(`((?:\\`|[^`])*)`|"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const raw = m[2] ?? m[3] ?? m[4] ?? "";
      const dynamic = /\$\{/.test(raw);
      out.push({ file: path.relative(root, file), sql: raw.replace(/\$\{[^}]*\}/g, "?").replace(/\\`/g, "`"), dynamic });
    }
  }
  return out;
}

let pool: pg.Pool;
beforeAll(async () => {
  pool = new pg.Pool({ connectionString: URL, max: 2 });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(migDir, name), "utf8") }));
  await migrate(pool, files);
});
afterAll(() => pool?.end());

describe("the Worker's own SQL, prepared by Postgres against the migrated schema", () => {
  const all = extract();
  const fixed = all.filter((q) => !q.dynamic && /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(q.sql));

  it("finds a realistic number of statements", () => {
    expect(all.length).toBeGreaterThan(500);
    expect(fixed.length).toBeGreaterThan(300);
  });

  it("numbers and prepares every fixed statement", async () => {
    const failures: string[] = [];
    const client = await pool.connect();
    try {
      let i = 0;
      for (const q of fixed) {
        let text: string;
        try {
          text = numberPlaceholders(q.sql).text;
        } catch (e) {
          failures.push(`${q.file}: placeholders: ${(e as Error).message}\n    ${q.sql.replace(/\s+/g, " ").slice(0, 160)}`);
          continue;
        }
        try {
          await client.query(`PREPARE q${++i} AS ${text}`);
          await client.query(`DEALLOCATE q${i}`);
        } catch (e) {
          failures.push(`${q.file}: ${(e as Error).message}\n    ${text.replace(/\s+/g, " ").slice(0, 200)}`);
        }
      }
    } finally {
      client.release();
    }
    expect(failures.join("\n")).toBe("");
  });
});
