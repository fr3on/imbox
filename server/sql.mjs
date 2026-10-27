// What the server does to the API's SQL before it reaches PostgreSQL: it numbers the placeholders. The SQL is written for PostgreSQL (see imbox-website/docs/content/docs/database.mdx), with a
// `?` where a parameter goes; PostgreSQL wants `$1, $2, ...`. A `?` inside a string, a quoted name or a comment is not a parameter and is left alone.

const MASK_OPEN = "\u0001";
const MASK_CLOSE = "\u0002";

/** Replace string literals, quoted identifiers and comments with markers, so a `?` or a keyword inside them is never touched. */
export function mask(sql) {
  const kept = [];
  let out = "";
  let i = 0;
  const keep = (text) => {
    kept.push(text);
    out += `${MASK_OPEN}${kept.length - 1}${MASK_CLOSE}`;
  };
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      keep(sql.slice(i, j + 1));
      i = j + 1;
    } else if (c === "$" && /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(i, i + 64))) {
      // A dollar-quoted body ($$ ... $$ or $tag$ ... $tag$), such as a function's: nothing inside it is ours to read.
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64))[0];
      const j = sql.indexOf(tag, i + tag.length);
      keep(sql.slice(i, j === -1 ? sql.length : j + tag.length));
      i = j === -1 ? sql.length : j + tag.length;
    } else if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      keep(sql.slice(i, j === -1 ? sql.length : j));
      i = j === -1 ? sql.length : j;
    } else if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      keep(sql.slice(i, j === -1 ? sql.length : j + 2));
      i = j === -1 ? sql.length : j + 2;
    } else {
      out += c;
      i++;
    }
  }
  return { masked: out, kept };
}

export function unmask(masked, kept) {
  return masked.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"), (_m, n) => kept[Number(n)]);
}

/**
 * @param {string} sql one statement with `?` placeholders
 * @returns {{ text: string, params: number }} the statement with `$1, $2, ...`, and how many parameters it has
 */
export function numberPlaceholders(sql) {
  const { masked, kept } = mask(sql.trim().replace(/;\s*$/, ""));
  let n = 0;
  return { text: unmask(masked.replace(/\?/g, () => `$${++n}`), kept), params: n };
}

/** The statements of a migration file: full-line comments dropped, split on `;` at the end of a line (not inside a string or a $$ body). */
export function splitStatements(sql) {
  const { masked, kept } = mask(
    sql
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n")
  );
  return masked
    .split(/;\s*(?:\n|$)/)
    .map((s) => unmask(s, kept).trim())
    .filter((s) => s.length > 0);
}
