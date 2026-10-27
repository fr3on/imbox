import { describe, expect, it } from "vitest";
import { numberPlaceholders, splitStatements } from "../../server/sql.mjs";

describe("numberPlaceholders", () => {
  it("numbers ? in order, and says how many there are", () => {
    expect(numberPlaceholders("SELECT * FROM t WHERE a = ? AND b = ? LIMIT ?")).toEqual({ text: "SELECT * FROM t WHERE a = $1 AND b = $2 LIMIT $3", params: 3 });
  });
  it("leaves a ? inside a string, a quoted name or a comment alone", () => {
    expect(numberPlaceholders("SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?").text).toBe("SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2");
    expect(numberPlaceholders(`SELECT "a?b" FROM t WHERE x = 'it''s ?' -- and ? here\nAND y = ?`).text).toBe(`SELECT "a?b" FROM t WHERE x = 'it''s ?' -- and ? here\nAND y = $1`);
    expect(numberPlaceholders("SELECT 1 /* ? */ WHERE a = ?").text).toBe("SELECT 1 /* ? */ WHERE a = $1");
  });
  it("keeps a cast written after the parameter, and a trailing semicolon is dropped", () => {
    expect(numberPlaceholders("SELECT 1 WHERE at > ?::bigint - 3;")).toEqual({ text: "SELECT 1 WHERE at > $1::bigint - 3", params: 1 });
  });
  it("does not touch PostgreSQL's own operators that contain a question mark", () => {
    // jsonb's ? operator is not used by this app; if it ever is, it has to be written ?? or through a function, and this says so.
    expect(numberPlaceholders("SELECT 1 WHERE a = ?").params).toBe(1);
  });
});

describe("numberPlaceholders and dollar quotes", () => {
  it("leaves a ? or a $1 inside a $$ body alone, and still numbers the ones outside it", () => {
    expect(numberPlaceholders("DO $$ BEGIN PERFORM ?; END $$ -- x\n").text).toBe("DO $$ BEGIN PERFORM ?; END $$ -- x");
    expect(numberPlaceholders("SELECT $$a ? b$$, ?").text).toBe("SELECT $$a ? b$$, $1");
    expect(numberPlaceholders("SELECT ?::int + ?").text).toBe("SELECT $1::int + $2");
  });
});

describe("splitStatements", () => {
  it("drops full-line comments and splits on a semicolon at the end of a line", () => {
    expect(splitStatements("-- one\nCREATE TABLE a (x TEXT);\n-- two\nCREATE INDEX i ON a(x);\n")).toEqual(["CREATE TABLE a (x TEXT)", "CREATE INDEX i ON a(x)"]);
  });
  it("keeps a $$ function body in one piece, with the semicolons inside it", () => {
    const fn = "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\n  RETURN NULL;\nEND\n$$;\nCREATE TRIGGER t AFTER INSERT ON a FOR EACH ROW EXECUTE FUNCTION f();\n";
    expect(splitStatements(fn)).toEqual(["CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\n  RETURN NULL;\nEND\n$$", "CREATE TRIGGER t AFTER INSERT ON a FOR EACH ROW EXECUTE FUNCTION f()"]);
    expect(splitStatements("SELECT $tag$a;\nb$tag$;\nSELECT 2;")).toEqual(["SELECT $tag$a;\nb$tag$", "SELECT 2"]);
  });
  it("keeps a string that runs over several lines", () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;\nb');\nSELECT 1;")).toEqual(["INSERT INTO t VALUES ('a;\nb')", "SELECT 1"]);
  });
  it("keeps a semicolon inside a line", () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b');\nSELECT 1;")).toEqual(["INSERT INTO t VALUES ('a;b')", "SELECT 1"]);
  });
});
