import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, resetData, seedOutlookAccount, seedUser, testEnv } from "../helpers";
import { getMsAccessToken } from "../../src/api/microsoft";
import { openToken, sealStoredTokens, sealToken } from "../../src/api/secrets";
import type { AccountRow } from "../../src/api/db";

// Gmail and Outlook tokens used to sit in the accounts table as they came. They are sealed now, and rows from before are sealed in the background.

beforeAll(migrate);
beforeEach(async () => {
  await resetData();
  await seedUser("u1");
});

const row = () => testEnv.DB.prepare(`SELECT * FROM accounts WHERE id = 'acc1'`).first<AccountRow>();

describe("stored OAuth tokens", () => {
  it("seals rows written before, once, and leaves them readable", async () => {
    await seedOutlookAccount();
    expect((await row())!.access_token).toBe("tok");

    expect(await sealStoredTokens(testEnv)).toBe(1);
    const sealed = (await row())!;
    expect(sealed.access_token).toMatch(/^enc1:/);
    expect(sealed.refresh_token).toMatch(/^enc1:/);
    expect(sealed.access_token).not.toContain("tok");
    expect(await openToken(testEnv, sealed.refresh_token)).toBe("rtok");
    expect(await getMsAccessToken(testEnv, sealed)).toBe("tok");

    expect(await sealStoredTokens(testEnv)).toBe(0);
    expect((await row())!.access_token).toBe(sealed.access_token);
  });

  it("keeps a plain token readable until it is sealed", async () => {
    const plain = await seedOutlookAccount();
    expect(await getMsAccessToken(testEnv, plain)).toBe("tok");
  });

  it("does not seal a value twice, and keeps an empty token empty", async () => {
    const once = await sealToken(testEnv, "secret");
    expect(await sealToken(testEnv, once)).toBe(once);
    expect(await sealToken(testEnv, null)).toBeNull();
    expect(await sealToken(testEnv, "")).toBeNull();
    expect(await openToken(testEnv, null)).toBe("");
  });
});
