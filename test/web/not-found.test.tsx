import { describe, expect, it } from "vitest";
import { html } from "./render";
import NotFound from "@/pages/NotFound";

// The 404 page: public, says which address led nowhere, and offers a way in.

describe("the 404 page", () => {
  const out = html(<NotFound />, "/no/such/page");

  it("says nothing lives at the address that was asked for", () => {
    expect(out).toContain("wandered off.");
    expect(out).toContain("/no/such/page");
    expect(out).toContain(">404<");
  });

  it("offers a way in", () => {
    expect(out).toMatch(/Open your inbox|Sign in|Set up imbox/);
  });
});
