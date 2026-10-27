export interface QueryRow {
  file: string;
  line: number;
  where: string;
  kind: string;
  tables: string[];
  flags: string[];
  interp: string[];
  sql: string;
  terminal: string | null;
}
export const TAGS: [RegExp, "hot" | "warm" | "cold", string][];
export function tagOf(file: string): [RegExp, "hot" | "warm" | "cold", string] | null;
export function ownedTables(): Set<string>;
export function analyse(file: string, code: string, owned: Set<string>): QueryRow[];
export function inventory(): QueryRow[];
