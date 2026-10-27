import { describe, expect, it } from "vitest";
import { passwordStrength } from "../../src/web/lib/passwordStrength";

describe("the sign-up strength bar", () => {
  it("is empty for nothing and one bar for under eight characters", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abc")).toBe(1);
  });
  it("grows with length and a mix of characters", () => {
    expect(passwordStrength("abcdefgh")).toBe(1);
    expect(passwordStrength("abcdefghijkl")).toBe(2);
    expect(passwordStrength("Abcdefghij1k")).toBe(3);
    expect(passwordStrength("Correct-horse-battery-9")).toBe(4);
  });
});
