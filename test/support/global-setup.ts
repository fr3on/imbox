import pg from "pg";
import { ensureMigrations } from "../../src/api/migrations";
import { TEMPLATE, dbFor, isTestDatabase, urlFor } from "./pgenv";

// Once per run: a template database with every migration applied. Each test file copies it. Afterwards the copies are dropped.

export async function setup() {
  const admin = new pg.Pool({ connectionString: urlFor("postgres"), max: 1 });
  try {
    await admin.query("SELECT 1");
  } catch (e) {
    await admin.end().catch(() => {});
    throw new Error(`The tests need PostgreSQL (PG_TEST_URL, default postgres://inbox@localhost:54329/inbox_test). Start one with: docker compose -f docker-compose.dev.yml up -d db. (${(e as Error).message})`);
  }
  await dropTestDatabases(admin);
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE}`);
  await admin.query(`CREATE DATABASE ${TEMPLATE}`);
  await admin.end();
  const tpl = new pg.Pool({ connectionString: urlFor(TEMPLATE), max: 1 });
  try {
    await ensureMigrations({ DB: dbFor(tpl), APP_NAME: "inbox" } as never);
  } finally {
    await tpl.end();
  }
}

async function dropTestDatabases(admin: pg.Pool) {
  const rows = (await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 't\\_%'")).rows as { datname: string }[];
  for (const { datname } of rows) if (isTestDatabase(datname)) await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
}

export async function teardown() {
  const admin = new pg.Pool({ connectionString: urlFor("postgres"), max: 1 });
  try {
    await dropTestDatabases(admin);
  } finally {
    await admin.end();
  }
}

