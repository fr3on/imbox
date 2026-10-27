#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the text of a query is read for its `${…}`, so the script and its tests write that as a string
// Lists every query in src/api: where it is, what it reads or writes, and what is worth a second look. Writes docs/perf/sql-inventory.md.
//   node scripts/sql-inventory.mjs            (writes the file)
//   node scripts/sql-inventory.mjs --check    (prints the summary only)
// Phase 1 of docs/sql-review.md. The flags are read from the text of each query and from where it sits in the code; they say "look here", not "this is wrong".
// How often a file's code runs (hot, warm, cold) is a decision, written down once in TAGS below. A file with no tag fails test/core/sql-inventory.test.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * How often the code that runs a query is reached. First match wins.
 *  hot:  on every page load, every request or every arriving message
 *  warm: when a person opens a page or does a thing
 *  cold: settings, sign-in, setup, integrations, jobs that run rarely
 */
export const TAGS = [
  // Every authenticated request starts here.
  [/^src\/api\/auth\.ts$/, "hot", "reads the session on every request"],
  [/^src\/api\/db\.ts$/, "hot", "the shared helpers every list and lookup calls"],
  [/^src\/api\/runtime\.d\.ts$/, "cold", "types only"],
  // The mail the app is opened for.
  [/^src\/api\/routes\/mail\/(lists|search|thread)\.ts$/, "hot", "the Imbox, the lists, search and a thread"],
  [/^src\/api\/routes\/mail\/(messages|files)\.ts$/, "warm", "attachments, source and files"],
  [/^src\/api\/(search|searchFacets|searchRank)\.ts$/, "hot", "search"],
  [/^src\/api\/routes\/screener\.ts$/, "hot", "the Screener, the slowest list"],
  [/^src\/api\/threadActions\.ts$/, "hot", "every triage key press"],
  // Mail arriving.
  [/^src\/api\/(ingest|sync|inbound|people|autoletin|autoletin-job|vacation|imapbox|outlook|google|microsoft)\.ts$/, "hot", "runs for every arriving message or every sync"],
  [/^src\/api\/sqlRows\.ts$/, "hot", "the multi-row writes of ingest and the calendar syncs"],
  [/^src\/api\/cron\.ts$/, "hot", "runs every minute"],
  [/^src\/api\/notifications\.ts$/, "warm", "the bell"],
  [/^src\/api\/(photos|bimi|messagesource|contactInsights|privacy|phish|activity)\.ts$/, "warm", "pictures and lookups beside the lists"],
  [/^src\/api\/(send|webpush|push)\.ts$/, "warm", "sending and notifying"],
  [/^src\/api\/routes\/(bundles|contacts|labels|collections|clips|searches|compose|brief|autoagents|workflows|activity)\.ts$/, "warm", "a page a person opens"],
  // The assistant and the agents.
  [/^src\/api\/ai\/(brief|digest|jev|catchup|summaries|searchanswer|memory|chat|gist|screener|rescue|contactreview|autocalendar|actions|metering|provider)\.ts$/, "warm", "assistant features, run when asked or on a schedule"],
  [/^src\/api\/ai\/tools(\.ts|\/)/, "warm", "what the assistant can do for a person"],
  [/^src\/api\/routes\/ai\//, "warm", "assistant routes"],
  [/^src\/api\/(autoagent|workflows\/(run|ai|insights))\.ts$/, "warm", "auto agents answering mail"],
  // The calendar.
  [/^src\/api\/calendar\//, "warm", "calendar reads and syncs"],
  [/^src\/api\/routes\/calendar\//, "warm", "calendar routes"],
  // Everything else is set up once or rarely.
  [/^src\/api\/routes\/(auth|domains|stalwart|system|agents|agent|accounts|me|push|vacation)(\.ts|\/)/, "cold", "sign-in, setup, accounts and integrations"],
  [/^src\/api\/(agent|passkeys|oauth|extensionTokens|stalwartsync|secrets|timezone|migrations|database|index)\.ts$/, "cold", "setup, keys and plumbing"],
];

export const tagOf = (file) => TAGS.find(([re]) => re.test(file)) ?? null;

const SKIP_DIRS = new Set(["node_modules"]);
function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (/\.(ts|mts)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Tables that belong to a user or an account, from the generated schema, with the columns that say whose they are. */
export function ownedTables() {
  const src = fs.readFileSync(path.join(root, "src/api/schema.ts"), "utf8");
  const owned = new Set();
  for (const m of src.matchAll(/\/\*\* A row of `([a-z_0-9]+)`\. \*\/\s*export interface \w+ \{([\s\S]*?)\n\}/g)) {
    if (/\n\s+(user_id|account_id):/.test(m[2])) owned.add(m[1]);
  }
  return owned;
}

/** Code that answers a request or a tool call for a person: a query here with nothing about whose rows it wants is checked. Jobs work on rows they already own. */
const REQUEST_DRIVEN = /^src\/api\/(routes\/|ai\/tools|agent\.ts|ai\/actions)/;

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"]);
const LOOPS = new Set(["ForStatement", "ForOfStatement", "ForInStatement", "WhileStatement", "DoWhileStatement"]);
const ITERATORS = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every", "find"]);
const VERBS = new Set(["get", "post", "put", "patch", "delete"]);
const TERMINALS = new Set(["all", "first", "run", "raw"]);

function walk(node, parents, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parents);
  parents.push(node);
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) walk(c, parents, visit);
    else if (v && typeof v.type === "string") walk(v, parents, visit);
  }
  parents.pop();
}

/** The `${…}` in a query, said by kind: a list of `?`, a named fragment, or something else (which is what to read). */
function interpolations(exprs) {
  const kinds = { list: 0, fragment: 0, other: 0 };
  const others = [];
  for (const e of exprs) {
    if (/placeholders\(|inClause\(|\.map\(\s*\(\s*_?\w*\s*\)\s*=>\s*"\?"\s*\)|"\?"/.test(e)) kinds.list++;
    else if (/^[A-Z][A-Z0-9_]*$/.test(e) || /^[\w.]+\.sql$/.test(e) || /^[A-Z][A-Z0-9_]*\./.test(e)) kinds.fragment++;
    else {
      kinds.other++;
      others.push(e.length > 40 ? `${e.slice(0, 37)}…` : e);
    }
  }
  return { kinds, others };
}

/** The text a query variable was given in this file (`const sql = \`…\``), the nearest one above the use, or null. */
function declared(ast, name, before) {
  let found = null;
  walk(ast.program, [], (n) => {
    if (n.type === "VariableDeclarator" && n.id?.name === name && n.init && n.start < before && (n.init.type === "TemplateLiteral" || n.init.type === "StringLiteral")) found = n.init;
  });
  return found;
}

export function analyse(file, code, owned) {
  const ast = parse(code, { sourceType: "module", plugins: ["typescript"], errorRecovery: true });
  const rows = [];
  walk(ast.program, [], (node, parents) => {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed) return;
    if (node.callee.property.name !== "prepare" || !node.arguments.length) return;
    let arg = node.arguments[0];
    if (arg.type === "Identifier") arg = declared(ast, arg.name, node.start) ?? arg;
    let sql;
    let exprs = [];
    let dynamic = false;
    if (arg.type === "TemplateLiteral") {
      sql = arg.quasis.map((q, i) => q.value.cooked + (i < arg.expressions.length ? "${…}" : "")).join("");
      exprs = arg.expressions.map((e) => code.slice(e.start, e.end).replace(/\s+/g, " "));
    } else if (arg.type === "StringLiteral") sql = arg.value;
    else if (arg.type === "BinaryExpression" || arg.type === "TemplateElement") {
      sql = code.slice(arg.start, arg.end);
      dynamic = true;
    } else {
      sql = `<${code.slice(arg.start, arg.end).replace(/\s+/g, " ")}>`;
      dynamic = true;
    }
    const text = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();

    // The chain after prepare: .bind(…).all() and so on. A statement with no terminal is collected into a batch.
    let top = node;
    let terminal = null;
    for (let i = parents.length - 1; i >= 0; i--) {
      const p = parents[i];
      if (p.type === "MemberExpression" && p.object === top) {
        const call = parents[i - 1];
        if (call?.type === "CallExpression" && call.callee === p) {
          if (TERMINALS.has(p.property.name)) terminal = p.property.name;
          top = call;
          i--;
          continue;
        }
      }
      break;
    }

    // Where it sits: a route, a function, a loop.
    let route = null;
    let fn = null;
    let loop = false;
    let chunked = true;
    let iterated = false;
    let crossed = false;
    for (let i = parents.length - 1; i >= 0; i--) {
      const p = parents[i];
      if (LOOPS.has(p.type) && !crossed) {
        loop = true;
        // A loop over `chunk(ids, 90)` asks once per piece of a list, not once per row.
        if (!(p.right && /\bchunk\(/.test(code.slice(p.right.start, p.right.end)))) chunked = false;
      }
      if (FUNCTIONS.has(p.type)) {
        const up = parents[i - 1];
        if (up?.type === "CallExpression" && up.callee?.type === "MemberExpression" && up.arguments.includes(p)) {
          const name = up.callee.property?.name;
          if (ITERATORS.has(name) && !crossed) {
            iterated = true;
            continue;
          }
          if (VERBS.has(name) && up.arguments[0]?.type === "StringLiteral") {
            route ??= `${name.toUpperCase()} ${up.arguments[0].value}`;
          }
        }
        if (!fn) {
          if (p.id?.name) fn = p.id.name;
          else if (p.key?.name) fn = p.key.name;
          else if (up?.type === "VariableDeclarator" && up.id?.name) fn = up.id.name;
        }
        if (!(parents[i - 1]?.type === "CallExpression" && ITERATORS.has(parents[i - 1].callee?.property?.name))) crossed = true;
      }
    }

    const first = (text.match(/^\s*\(?\s*(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|LOCK|SET|SHOW|EXPLAIN|ANALYZE|VACUUM|NOTIFY|LISTEN|VALUES)\b/i)?.[1] ?? "?").toUpperCase();
    const write = /^(INSERT|UPDATE|DELETE)/.test(first) || /^WITH\b[\s\S]*\b(INSERT|UPDATE|DELETE)\b/i.test(text);
    const led = text.startsWith("${…}") && !/\b(INSERT|UPDATE|DELETE)\b/i.test(text);
    const kind = led ? "read" : write ? "write" : first === "SELECT" || first === "WITH" || first === "VALUES" ? "read" : first === "?" ? "?" : first === "CREATE" || first === "ALTER" || first === "DROP" ? "ddl" : "other";
    const tables = [...new Set([...text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)\b/gi)].map((m) => m[1].toLowerCase()).filter((t) => !["select", "set", "only", "lateral", "unnest", "generate_series"].includes(t)))];

    const interp = interpolations(exprs);
    const flags = [];
    if (dynamic) flags.push("dynamic");
    if (/\bSELECT\s+(DISTINCT\s+)?(\*|\w+\.\*)/i.test(text) && kind === "read") flags.push("select-star");
    if (/\bI?LIKE\b/i.test(text)) flags.push("like");
    if (/\bOFFSET\b/i.test(text)) flags.push("offset");
    if (/\bNOT IN\b/i.test(text)) flags.push("not-in");
    if (kind === "read" && !/\bLIMIT\b/i.test(text) && !/\bCOUNT\(|\bSUM\(|\bMAX\(|\bMIN\(|\bAVG\(/i.test(text) && !/\b(id|key|thread_id|account_id|user_id)\s*=\s*\?\s*(LIMIT|$)/i.test(text)) flags.push("no-limit");
    if (interp.kinds.other) flags.push("interp-other");
    if (interp.kinds.list || interp.kinds.fragment) flags.push("interp");
    if (terminal && loop && chunked) flags.push("chunked");
    else if (terminal && (loop || iterated)) flags.push(loop ? "in-loop" : "per-item");
    if (!terminal && !/^(CREATE|ALTER|DROP)/i.test(first)) flags.push("batched");
    if (REQUEST_DRIVEN.test(file) && !exprs.length && tables.some((t) => owned.has(t)) && !/\buser_id\b/.test(text) && !/\baccount_id\b/.test(text)) flags.push("scope?");

    rows.push({
      file,
      line: node.loc.start.line,
      where: route ?? fn ?? "",
      kind,
      tables,
      flags,
      interp: interp.others,
      sql: text,
      terminal,
    });
  });
  return rows;
}

/** Every query in src/api, in file and line order. */
export function inventory() {
  const owned = ownedTables();
  const out = [];
  for (const f of listFiles(path.join(root, "src/api")).sort()) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    const code = fs.readFileSync(f, "utf8");
    if (!code.includes("prepare(")) continue;
    out.push(...analyse(rel, code, owned));
  }
  return out;
}

const esc = (s) => s.replace(/\|/g, "\\|").replace(/`/g, "'");
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function render(rows) {
  const by = (f) => rows.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map());
  const tagged = rows.map((r) => ({ ...r, tag: tagOf(r.file)?.[1] ?? "untagged" }));
  const flagCount = new Map();
  for (const r of rows) for (const f of r.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
  const files = [...new Set(rows.map((r) => r.file))];
  const lines = [];
  lines.push("# SQL inventory", "");
  lines.push("Every query in `src/api`, written by `node scripts/sql-inventory.mjs` (phase 1 of [the SQL review](../sql-review.md)). Do not edit by hand; run `npm run inventory:sql`. Line numbers move as code changes, so this is a map for the review, not something kept in step.", "");
  lines.push(`**${rows.length} queries in ${files.length} files.** ${["hot", "warm", "cold"].map((t) => `${t}: ${tagged.filter((r) => r.tag === t).length}`).join(", ")}.`, "");
  lines.push("## Tags", "", "How often the code that runs a query is reached. Set per file in `TAGS` at the top of the script.", "", "- **hot**: every page load, every request or every arriving message", "- **warm**: when a person opens a page or does a thing", "- **cold**: settings, sign-in, setup, integrations", "");
  lines.push("## Flags", "", "Read from the query text and from where it sits. They say where to look, not that something is wrong.", "");
  lines.push("| Flag | Meaning | Queries |", "|---|---|---:|");
  const MEANING = {
    "select-star": "`SELECT *` or `SELECT x.*`: reads every column, including large ones",
    like: "`LIKE` or `ILIKE`: a search; the pattern is a bound value, so check whether it starts with `%`",
    offset: "`OFFSET` paging",
    "not-in": "`NOT IN`: slower than `NOT EXISTS` on a long list, and surprising with nulls",
    "no-limit": "a read with no `LIMIT`, not by a key and not an aggregate",
    "interp-other": "`${…}` that is not a list of `?` or a named fragment: read the expression",
    interp: "`${…}` that is a list of `?` or a named fragment",
    "in-loop": "awaited inside a `for` or `while` over rows: one round trip per turn",
    chunked: "awaited inside a loop over `chunk(…)`: one round trip per piece of a list (see the baseline: the pieces are 90 long, a limit PostgreSQL does not have)",
    "per-item": "awaited inside `.map`, `.forEach` and the like: one round trip per item",
    batched: "collected into a `batch` and sent with others, not awaited alone",
    "scope?": "in code that answers a request: touches a table of a user's or an account's and has no `user_id` or `account_id` in its text and no `${…}` that could carry them. Check that the caller has scoped it",
    dynamic: "the query is built outside `prepare(…)` and could not be read",
  };
  for (const [f, m] of Object.entries(MEANING)) lines.push(`| \`${f}\` | ${m} | ${flagCount.get(f) ?? 0} |`);
  lines.push("");
  const kinds = by((r) => r.kind);
  lines.push(`Kinds: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}. Queries awaited alone: ${rows.filter((r) => r.terminal).length}; collected into batches: ${rows.filter((r) => !r.terminal).length}.`, "");

  for (const tag of ["hot", "warm", "cold", "untagged"]) {
    const inTag = tagged.filter((r) => r.tag === tag);
    if (!inTag.length) continue;
    lines.push(`## ${tag[0].toUpperCase()}${tag.slice(1)} (${inTag.length})`, "");
    const perFile = [...new Set(inTag.map((r) => r.file))];
    for (const f of perFile) {
      const mine = inTag.filter((r) => r.file === f);
      const why = tagOf(f)?.[2];
      lines.push(`### \`${f}\` (${mine.length})`, "");
      if (why) lines.push(`${why}.`, "");
      lines.push("| Line | Where | Kind | Tables | Flags | Query |", "|---:|---|---|---|---|---|");
      for (const r of mine) {
        const flags = r.flags.filter((x) => x !== "interp" || !r.flags.includes("interp-other")).join(", ");
        const extra = r.interp.length ? ` (${esc(r.interp.join("; "))})` : "";
        lines.push(`| ${r.line} | ${esc(r.where)} | ${r.kind} | ${r.tables.join(", ")} | ${flags}${esc(extra)} | \`${esc(cut(r.sql, 90))}\` |`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = inventory();
  const md = render(rows);
  if (process.argv.includes("--check")) {
    console.log(`${rows.length} queries in ${new Set(rows.map((r) => r.file)).size} files`);
    const flagCount = new Map();
    for (const r of rows) for (const f of r.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
    console.log([...flagCount].map(([f, n]) => `${f} ${n}`).join(", "));
  } else {
    const out = path.join(root, "docs/perf/sql-inventory.md");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md);
    console.log(`wrote ${path.relative(root, out)}: ${rows.length} queries`);
  }
}
