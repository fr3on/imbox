import { describe, expect, it } from "vitest";
import { afterYourReply, type ActionsResult } from "../../src/api/ai/actions";

const found: ActionsResult = {
  actions: [
    { id: "a", kind: "event", title: "Call", why: "", when: null, where: "", message_id: "m" },
    { id: "b", kind: "deadline", title: "Send the form", why: "", when: null, where: "", message_id: "m" },
    { id: "c", kind: "task", title: "Reply with details", why: "", when: null, where: "", message_id: "m" },
  ],
  overview: { id: "o", what: "Asks for details", ask: "Send more detail", urgent: false, due: null, facts: [] },
};

describe("afterYourReply", () => {
  it("leaves everything while the last word is theirs", () => {
    expect(afterYourReply(found, [{ is_from_me: false }, { is_from_me: true }, { is_from_me: false }])).toBe(found);
  });

  it("drops the overview and the requests once the last message is yours, and keeps a proposed meeting", () => {
    const out = afterYourReply(found, [{ is_from_me: false }, { is_from_me: true }]);
    expect(out.overview).toBeNull();
    expect(out.actions.map((a) => a.id)).toEqual(["a"]);
  });

  it("copes with a thread that has no messages", () => {
    expect(afterYourReply(found, [])).toBe(found);
  });
});
