import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/api/ai/crypto";

describe("stored secrets", () => {
  it("come back unchanged, and are different each time they are written", async () => {
    const a = await encryptSecret("server-secret", "sk-live-123");
    const b = await encryptSecret("server-secret", "sk-live-123");
    expect(a).not.toContain("sk-live");
    expect(a).not.toBe(b);
    expect(await decryptSecret("server-secret", a)).toBe("sk-live-123");
  });

  it("cannot be read with another key or after tampering", async () => {
    const packed = await encryptSecret("server-secret", "value");
    await expect(decryptSecret("other-secret", packed)).rejects.toThrow();
    const raw = atob(packed);
    const flipped = btoa(raw.slice(0, -1) + String.fromCharCode(raw.charCodeAt(raw.length - 1) ^ 1));
    await expect(decryptSecret("server-secret", flipped)).rejects.toThrow();
  });

  it("refuse to work with no server secret", async () => {
    await expect(encryptSecret(undefined, "x")).rejects.toThrow("session_secret_missing");
  });
});
