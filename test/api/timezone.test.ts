import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { cleanZone, pickZone, userTimezone } from "../../src/api/timezone";

// Where a person is comes from one place: the calendar timezone they chose, else the one their browser reports in X-Timezone, else UTC.

describe("pickZone and cleanZone", () => {
  it("prefers the saved zone, then the detected one, and skips what Intl does not know", () => {
    expect(pickZone("Africa/Cairo", "Asia/Riyadh")).toBe("Africa/Cairo");
    expect(pickZone("", "Asia/Riyadh")).toBe("Asia/Riyadh");
    expect(pickZone("Nope/Zone", "Asia/Riyadh")).toBe("Asia/Riyadh");
    expect(pickZone("", "")).toBe("UTC");
    expect(pickZone(null, undefined)).toBe("UTC");
  });
  it("keeps a header value only when it is a real zone", () => {
    expect(cleanZone(" Europe/London ")).toBe("Europe/London");
    expect(cleanZone("Nope/Zone")).toBe("");
    expect(cleanZone("x".repeat(80))).toBe("");
    expect(cleanZone(undefined)).toBe("");
    expect(cleanZone(42)).toBe("");
  });
});

describe("the X-Timezone header", () => {
  let session = "";
  beforeAll(migrate);
  beforeEach(async () => {
    await wipeAll();
    session = await signIn("u1");
  });
  const detected = async () => (await testEnv.DB.prepare(`SELECT detected_timezone AS z FROM users WHERE id = 'u1'`).first<{ z: string }>())?.z;

  it("is stored when it changes, and ignored when it is not a zone", async () => {
    await call("GET", "/api/brief", { token: session, headers: { "x-timezone": "Africa/Cairo" } });
    expect(await detected()).toBe("Africa/Cairo");
    await call("GET", "/api/brief", { token: session, headers: { "x-timezone": "Nope/Zone" } });
    expect(await detected()).toBe("Africa/Cairo");
    await call("GET", "/api/brief", { token: session, headers: { "x-timezone": "Asia/Riyadh" } });
    expect(await detected()).toBe("Asia/Riyadh");
  });

  it("answers for the brief without a ?tz= on the address, and gives way to a saved calendar timezone", async () => {
    await call("GET", "/api/brief", { token: session, headers: { "x-timezone": "Pacific/Kiritimati" } });
    expect(await userTimezone(testEnv.DB, "u1")).toBe("Pacific/Kiritimati");
    const day = (await json<any>(await call("GET", "/api/brief", { token: session, headers: { "x-timezone": "Pacific/Kiritimati" } }))).brief.day;
    expect(day).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date()));
    await call("PUT", "/api/calendar/settings", { token: session, body: { timezone: "Pacific/Pago_Pago" } });
    expect(await userTimezone(testEnv.DB, "u1")).toBe("Pacific/Pago_Pago");
  });
});
