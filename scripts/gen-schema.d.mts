import type pg from "pg";
export function renderSchema(pool: pg.Pool): Promise<string>;
export function migratedPool(url: string, dir: string): Promise<pg.Pool>;
