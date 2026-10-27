// Self-applying migrations: the SQL files are bundled as text and applied on first use,
// tracked in the `d1_migrations` table.
// Add every new migrations/*.sql file here (the bundle cannot read the directory at runtime).
import type { Env } from "./env";
import { splitStatements } from "../../server/sql.mjs";
import m0001 from "../../migrations/0001_core.sql";
import m0002 from "../../migrations/0002_accounts.sql";
import m0003 from "../../migrations/0003_mail_core.sql";
import m0004 from "../../migrations/0004_contacts_address_book.sql";
import m0005 from "../../migrations/0005_domains.sql";
import m0006 from "../../migrations/0006_auth_security.sql";
import m0007 from "../../migrations/0007_bundles.sql";
import m0008 from "../../migrations/0008_imap_stalwart.sql";
import m0009 from "../../migrations/0009_oauth.sql";
import m0010 from "../../migrations/0010_calendar.sql";
import m0011 from "../../migrations/0011_ai_core.sql";
import m0012 from "../../migrations/0012_agent_mail.sql";
import m0013 from "../../migrations/0013_auto_agents.sql";
import m0014 from "../../migrations/0014_screener_and_hints.sql";
import m0015 from "../../migrations/0015_thread_intelligence.sql";
import m0016 from "../../migrations/0016_contact_reviews.sql";
import m0017 from "../../migrations/0017_daily_briefs_and_thoughts.sql";
import m0018 from "../../migrations/0018_push_and_notifications.sql";
import m0019 from "../../migrations/0019_send_reliability.sql";
import m0020 from "../../migrations/0020_data_repairs.sql";
import m0021 from "../../migrations/0021_saved_searches.sql";
import m0022 from "../../migrations/0022_extension_tokens.sql";
import m0023 from "../../migrations/0023_search_indexes.sql";
import m0024 from "../../migrations/0024_count_indexes.sql";
import m0025 from "../../migrations/0025_drop_flex_time.sql";
import m0026 from "../../migrations/0026_domains_http.sql";
import m0027 from "../../migrations/0027_thread_notify.sql";
import m0028 from "../../migrations/0028_account_notify.sql";
import m0029 from "../../migrations/0029_drop_mem0.sql";
import m0030 from "../../migrations/0030_detected_timezone.sql";
import m0031 from "../../migrations/0031_contacts_search.sql";
import m0032 from "../../migrations/0032_attachment_indexes.sql";
import m0033 from "../../migrations/0033_person_indexes.sql";
import m0034 from "../../migrations/0034_contact_lower_email.sql";
import m0035 from "../../migrations/0035_updates_digest.sql";
import m0036 from "../../migrations/0036_phishing.sql";
import m0037 from "../../migrations/0037_activity_log.sql";
import m0038 from "../../migrations/0038_jev.sql";
import m0039 from "../../migrations/0039_workflows.sql";

export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: "0001_core.sql", sql: m0001 },
  { name: "0002_accounts.sql", sql: m0002 },
  { name: "0003_mail_core.sql", sql: m0003 },
  { name: "0004_contacts_address_book.sql", sql: m0004 },
  { name: "0005_domains.sql", sql: m0005 },
  { name: "0006_auth_security.sql", sql: m0006 },
  { name: "0007_bundles.sql", sql: m0007 },
  { name: "0008_imap_stalwart.sql", sql: m0008 },
  { name: "0009_oauth.sql", sql: m0009 },
  { name: "0010_calendar.sql", sql: m0010 },
  { name: "0011_ai_core.sql", sql: m0011 },
  { name: "0012_agent_mail.sql", sql: m0012 },
  { name: "0013_auto_agents.sql", sql: m0013 },
  { name: "0014_screener_and_hints.sql", sql: m0014 },
  { name: "0015_thread_intelligence.sql", sql: m0015 },
  { name: "0016_contact_reviews.sql", sql: m0016 },
  { name: "0017_daily_briefs_and_thoughts.sql", sql: m0017 },
  { name: "0018_push_and_notifications.sql", sql: m0018 },
  { name: "0019_send_reliability.sql", sql: m0019 },
  { name: "0020_data_repairs.sql", sql: m0020 },
  { name: "0021_saved_searches.sql", sql: m0021 },
  { name: "0022_extension_tokens.sql", sql: m0022 },
  { name: "0023_search_indexes.sql", sql: m0023 },
  { name: "0024_count_indexes.sql", sql: m0024 },
  { name: "0025_drop_flex_time.sql", sql: m0025 },
  { name: "0026_domains_http.sql", sql: m0026 },
  { name: "0027_thread_notify.sql", sql: m0027 },
  { name: "0028_account_notify.sql", sql: m0028 },
  { name: "0029_drop_mem0.sql", sql: m0029 },
  { name: "0030_detected_timezone.sql", sql: m0030 },
  { name: "0031_contacts_search.sql", sql: m0031 },
  { name: "0032_attachment_indexes.sql", sql: m0032 },
  { name: "0033_person_indexes.sql", sql: m0033 },
  { name: "0034_contact_lower_email.sql", sql: m0034 },
  { name: "0035_updates_digest.sql", sql: m0035 },
  { name: "0036_phishing.sql", sql: m0036 },
  { name: "0037_activity_log.sql", sql: m0037 },
  { name: "0038_jev.sql", sql: m0038 },
  { name: "0039_workflows.sql", sql: m0039 },
];

let ready: Promise<void> | null = null;

/** Apply pending migrations once per isolate. Cheap after the first call (a single SELECT, then cached). */
export function ensureMigrations(env: Env): Promise<void> {
  if (!ready) {
    ready = run(env).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** The first 26 migrations were written for SQLite and have shipped; they are read for PostgreSQL by server/legacy-migrations.mjs. Every later one is PostgreSQL as written. */
export const LAST_LEGACY_MIGRATION = 26;
const isLegacy = (name: string) => Number.parseInt(name, 10) <= LAST_LEGACY_MIGRATION;

async function run(env: Env) {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at BIGINT NOT NULL)`),
  ]);
  const rows = await db.prepare(`SELECT name FROM d1_migrations`).all<{ name: string }>();
  const applied = new Set(rows.results.map((r) => r.name));
  const pending = MIGRATIONS.filter((m) => !applied.has(m.name));
  for (const m of pending) {
    const source = isLegacy(m.name) ? (db.legacyDialect?.() ?? db) : db;
    const stmts = splitStatements(m.sql).map((s) => source.prepare(s));
    stmts.push(db.prepare(`INSERT INTO d1_migrations (name) VALUES (?)`).bind(m.name));
    await db.batch(stmts);
    try {
      await db.prepare(`INSERT INTO sync_log (account_id, level, message, created_at) VALUES (NULL, 'info', ?, ?)`).bind(`Applied migration ${m.name}`, Date.now()).run();
    } catch {
      /* sync_log may not exist yet on very early migrations */
    }
  }
}
