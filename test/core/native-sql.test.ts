import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pool } from "../support/env";

// The queries are written for PostgreSQL (imbox-website/docs/content/docs/database.mdx). PostgreSQL itself refuses most SQLite spellings, but not all: LIKE is case-sensitive instead of failing, and a
// missing NULLS clause or ::bigint changes what a query does without an error. This reads the source, so every query is checked, including ones no test runs.
const root = path.resolve(__dirname, "../../src/api");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

/** The code without the whole-line comments and block comments, which are free to mention the old spellings. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
}

/** MIN(a, b) and MAX(a, b) with a comma at the top level are SQLite's two-argument functions; MAX(x) alone and MAX(f(a, b)) are the aggregate. */
function scalarMinMax(text: string): number[] {
  const found: number[] = [];
  const re = /\b(MIN|MAX)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) break;
      else if (text[i] === "," && depth === 1) {
        found.push(m.index);
        break;
      }
    }
  }
  return found;
}

const line = (text: string, at: number) => text.slice(0, at).split("\n").length;

describe("the queries are written for PostgreSQL", () => {
  const files = sources(root);
  const check = (what: string, find: (text: string) => number[]) =>
    it(what, () => {
      const hits: string[] = [];
      for (const f of files) {
        const text = code(fs.readFileSync(f, "utf8"));
        for (const at of find(text)) hits.push(`${path.relative(root, f)}:${line(text, at)}`);
      }
      expect(hits).toEqual([]);
    });
  const all = (re: RegExp) => (text: string) => [...text.matchAll(re)].map((m) => m.index ?? 0);

  check("none says INSERT OR IGNORE (write INSERT ... ON CONFLICT DO NOTHING)", all(/INSERT\s+OR\s+(IGNORE|REPLACE)/g));
  check("none says LIKE (write ILIKE)", all(/(?<![A-Za-z_])LIKE(?![A-Za-z_])/g));
  check("none says char(n) (write chr(n))", all(/\bchar\s*\(/g));
  check("none casts to INTEGER or BLOB (write BIGINT, BYTEA)", all(/\bAS\s+(INTEGER|BLOB)\b/gi));
  check("none uses a two-argument MIN or MAX (write LEAST or GREATEST)", scalarMinMax);
});

// SQLite puts NULLs first when ascending and last when descending; PostgreSQL puts them last either way. A query that leaves it out sorts differently here than the
// code expects, so each ORDER BY on a column that can be NULL says where they go. A column that is NOT NULL needs nothing, and is how an index can be read in order.
describe("ORDER BY says where NULLs go", () => {
  const files = sources(root);
  const KEYWORDS = /\b(LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|RETURNING|FOR\s+UPDATE|WINDOW)\b/;

  function clauseEnd(s: string, from: number): number {
    let depth = 0;
    for (let j = from; j < s.length; j++) {
      const c = s[j];
      if (c === "'") {
        const k = s.indexOf("'", j + 1);
        if (k === -1) return j;
        j = k;
      } else if (c === "`" || c === '"' || c === ";") return j;
      else if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) return j;
        depth--;
      } else if (depth === 0 && /[A-Za-z]/.test(c) && !/[\w]/.test(s[j - 1] ?? " ") && KEYWORDS.test(s.slice(j, j + 14)) && KEYWORDS.exec(s.slice(j, j + 14))?.index === 0) return j;
    }
    return s.length;
  }
  function terms(clause: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (let j = 0; j < clause.length; j++) {
      const c = clause[j];
      if (c === "'") {
        const k = clause.indexOf("'", j + 1);
        const end = k === -1 ? clause.length - 1 : k;
        cur += clause.slice(j, end + 1);
        j = end;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if (c === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out.map((t) => t.trim()).filter(Boolean);
  }

  it("every ORDER BY term that could be NULL has a NULLS clause", async () => {
    const db = await pool();
    const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' GROUP BY column_name HAVING bool_and(is_nullable = 'NO')`);
    const never = new Set(rows.map((r: { column_name: string }) => r.column_name.toLowerCase()));
    const literal = "(?:\\d+|'[^']*')";
    const cannotBeNull = (base: string) =>
      (/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/.test(base) && never.has(base.split(".").pop()!.toLowerCase())) ||
      new RegExp(`^COALESCE\\(.*,\\s*${literal}\\s*\\)$`, "s").test(base) ||
      new RegExp(`^CASE\\b.*\\bELSE\\s*${literal}\\s*END$`, "s").test(base);
    const hits: string[] = [];
    for (const f of files) {
      const text = code(fs.readFileSync(f, "utf8"));
      for (const m of text.matchAll(/ORDER\s+BY\s+/g)) {
        const a = (m.index ?? 0) + m[0].length;
        for (const term of terms(text.slice(a, clauseEnd(text, a)))) {
          if (/\bNULLS\s+(FIRST|LAST)$/i.test(term)) continue;
          const d = /\s+(ASC|DESC)$/i.exec(term);
          const base = (d ? term.slice(0, d.index) : term).trim();
          if (base.includes("${") || cannotBeNull(base)) continue;
          hits.push(`${path.relative(root, f)}:${line(text, a)}  ORDER BY ${term}`);
        }
      }
      // An ordering kept in a variable ("t.reply_later_at DESC") is checked on its own.
      for (const m of text.matchAll(/["'`]([A-Za-z_][\w.]*)\s+(ASC|DESC)(?!\s+NULLS)["'`]/g)) {
        if (!never.has(m[1].split(".").pop()!.toLowerCase())) hits.push(`${path.relative(root, f)}:${line(text, m.index ?? 0)}  "${m[0].slice(1, -1)}"`);
      }
    }
    expect(hits).toEqual([]);
  });
});

// PostgreSQL does integer arithmetic in 32 bits unless a number says otherwise; SQLite does it in 64. A millisecond timestamp, or a day count times 86400000,
// overflows. So a number of seven digits or more, a parameter in arithmetic, and a constant put into the SQL from the code, each carry ::bigint.
describe("numbers in arithmetic are 64-bit", () => {
  const SQL_WORD = /\b(SELECT|UPDATE|INSERT|DELETE|WHERE|SET|FROM|VALUES|ORDER BY|LIMIT)\b/;
  const LITERAL = /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
  const blank = (t: string, re: RegExp) => t.replace(re, (m) => m.replace(/[^\n]/g, " "));

  it("a big number, or a parameter in arithmetic, says ::bigint", () => {
    const hits: string[] = [];
    for (const f of sources(root)) {
      const text = code(fs.readFileSync(f, "utf8"));
      for (const lit of text.matchAll(LITERAL)) {
        if (!SQL_WORD.test(lit[0])) continue;
        // What is inside ${...} is code, and what is inside quotes is text: neither is the SQL's own arithmetic.
        const sql = blank(blank(lit[0], /\$\{[^}]*\}/g), /'[^']*'/g);
        const at = (i: number) => `${path.relative(root, f)}:${line(text, (lit.index ?? 0) + i)}`;
        for (const m of sql.matchAll(/(?<![\w.$:])\d{7,}(?![\w.])(?!::)/g)) hits.push(`${at(m.index ?? 0)}  ${m[0]}`);
        for (const m of sql.matchAll(/(?:[-+*/%]\s*\?(?!::)|\?(?!::)\s*[-+*/%](?!-))/g)) hits.push(`${at(m.index ?? 0)}  ${m[0].trim()}`);
        // A constant put in from the code: created_at / ${DAY} has to be created_at / ${DAY}::bigint.
        for (const m of lit[0].matchAll(/[-+*/%]\s*\$\{[A-Za-z_][\w.]*\}(?!::)/g)) hits.push(`${at(m.index ?? 0)}  ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
