// Writing many rows with few statements. Each statement of a batch is its own trip to PostgreSQL, so a row at a time is a round trip a row: these cut the rows into
// pieces of a few dozen and write each piece with one `INSERT ... VALUES (...), (...)` or one `UPDATE ... FROM (VALUES ...)`.

/** Most rows in one statement, and most text (in characters) a statement of messages carries. */
const ROWS_PER_STATEMENT = 50;
const TEXT_PER_STATEMENT = 2_000_000;

/** Rows cut into pieces of at most `ROWS_PER_STATEMENT`, and of at most `TEXT_PER_STATEMENT` characters when a row's weight is given. */
export function pieces(rows: unknown[][], weight?: (row: unknown[]) => number): unknown[][][] {
  const out: unknown[][][] = [];
  let cur: unknown[][] = [];
  let size = 0;
  for (const r of rows) {
    const w = weight ? weight(r) : 0;
    if (cur.length && (cur.length >= ROWS_PER_STATEMENT || size + w > TEXT_PER_STATEMENT)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += w;
  }
  if (cur.length) out.push(cur);
  return out;
}

export const marks = (n: number, types?: string[]) => `(${Array.from({ length: n }, (_, i) => (types ? `CAST(? AS ${types[i]})` : "?")).join(", ")})`;

/** `INSERT INTO table (columns) VALUES (…), (…) tail`: one statement for each piece of the rows. */
export function insertRows(db: Db, table: string, columns: string[], rows: unknown[][], tail = "", weight?: (row: unknown[]) => number): DbStatement[] {
  return pieces(rows, weight).map((part) =>
    db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${part.map(() => marks(columns.length)).join(", ")}${tail}`).bind(...part.flat())
  );
}

/**
 * `UPDATE table SET c = v.c ... FROM (VALUES (…), (…)) AS v(columns) WHERE table.id = v.id`: the rows are changed by the id in their first column. The values say their type
 * (`types[i]` for `columns[i]`), because a VALUES list with a NULL in a column cannot tell what the column is.
 */
export function updateRows(db: Db, table: string, columns: string[], types: string[], rows: unknown[][]): DbStatement[] {
  const sets = columns.slice(1).map((c) => `${c} = v.${c}`).join(", ");
  return pieces(rows).map((part) =>
    db
      .prepare(`UPDATE ${table} SET ${sets} FROM (VALUES ${part.map(() => marks(columns.length, types)).join(", ")}) AS v(${columns.join(", ")}) WHERE ${table}.${columns[0]} = v.${columns[0]}`)
      .bind(...part.flat())
  );
}
