import type { Pool } from "pg";
export function createHandler(pool: Pool): (request: Request) => Promise<Response>;
export function createExecutor(pool: Pool): (body: unknown) => Promise<{ results: { rows: Record<string, unknown>[]; changes: number }[] }>;
export function migrate(pool: Pool, files: { name: string; sql: string }[]): Promise<string[]>;
export function decodeParam(v: unknown): unknown;
