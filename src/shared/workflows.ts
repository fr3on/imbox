// Workflows: what one is made of, how a hand-written one is checked, and how a condition is matched against a message.
// Pure: no database, so the server and the settings screen agree on what is valid.

export const TRIGGERS = ["message_arrives", "no_reply"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const FIELDS = ["from", "to", "subject", "body", "has_attachment", "has_unsubscribe", "tray", "ai"] as const;
export type Field = (typeof FIELDS)[number];
export type Op = "contains" | "not_contains" | "is";

/** The fields that are a yes or no rather than text. */
export const YES_NO_FIELDS: Field[] = ["has_attachment", "has_unsubscribe"];
/** The trays a workflow may move mail into or test for. Never the trash: a rule written once should not be able to lose mail. */
export const TRAYS = ["imbox", "feed", "paper_trail"] as const;

export interface Condition {
  field: Field;
  op: Op;
  value: string;
}

export const ACTION_TYPES = ["label", "move", "mark_read", "set_aside", "reply_later", "snooze", "collection"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface Action {
  type: ActionType;
  /** label: the label id. collection: the collection id. */
  id?: string;
  /** move: the tray. */
  tray?: (typeof TRAYS)[number];
  /** snooze: hours until the thread comes back. */
  hours?: number;
}

export const LIMITS = { workflows: 20, conditions: 10, aiConditions: 2, actions: 5, name: 80, value: 200, maxDays: 60, maxHours: 24 * 90, maxDaily: 1000 } as const;
export const DEFAULT_DAILY = 200;

export interface WorkflowDef {
  name: string;
  trigger: Trigger;
  trigger_days: number;
  match: "all" | "any";
  conditions: Condition[];
  actions: Action[];
  account_ids: string[];
  daily_limit: number;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Check a workflow as sent by a client and return it clean, or the first thing wrong with it. */
export function normalizeWorkflow(raw: unknown, opts: { draft?: boolean } = {}): { ok: WorkflowDef } | { error: string } {
  const draft = !!opts.draft;
  if (!raw || typeof raw !== "object") return { error: "Send a workflow." };
  const r = raw as Record<string, unknown>;
  const name = str(r.name, LIMITS.name);
  if (!name) return { error: "Give the workflow a name." };
  const trigger = TRIGGERS.find((t) => t === r.trigger) ?? "message_arrives";
  const match = r.match === "any" ? "any" : "all";

  const conditions: Condition[] = [];
  const list = Array.isArray(r.conditions) ? r.conditions : [];
  if (list.length > LIMITS.conditions) return { error: `A workflow can have up to ${LIMITS.conditions} conditions.` };
  for (const c of list) {
    const o = (c ?? {}) as Record<string, unknown>;
    const field = FIELDS.find((f) => f === o.field);
    if (!field) {
      if (draft) continue;
      return { error: "A condition is missing what to look at." };
    }
    const value = str(o.value, LIMITS.value);
    if (field === "ai") {
      if (!value) {
        if (draft) continue;
        return { error: "Say what the AI should decide about the email." };
      }
      conditions.push({ field, op: "is", value });
    } else if (YES_NO_FIELDS.includes(field)) {
      conditions.push({ field, op: "is", value: value === "false" ? "false" : "true" });
    } else if (field === "tray") {
      if (!(TRAYS as readonly string[]).includes(value)) {
        if (draft) continue;
        return { error: "Pick a tray for the condition." };
      }
      conditions.push({ field, op: o.op === "not_contains" ? "not_contains" : "is", value });
    } else {
      if (!value) {
        if (draft) continue;
        return { error: "A condition needs a value to look for." };
      }
      const op: Op = o.op === "is" ? "is" : o.op === "not_contains" ? "not_contains" : "contains";
      conditions.push({ field, op, value });
    }
  }
  if (conditions.filter(isAiCondition).length > LIMITS.aiConditions) return { error: `A workflow can have up to ${LIMITS.aiConditions} AI conditions.` };
  if (!draft && trigger === "message_arrives" && !conditions.length) return { error: "Add at least one condition, or the workflow would touch every email." };

  const actions: Action[] = [];
  const acts = Array.isArray(r.actions) ? r.actions : [];
  if (!draft && !acts.length) return { error: "Add at least one action." };
  if (acts.length > LIMITS.actions) return { error: `A workflow can have up to ${LIMITS.actions} actions.` };
  for (const a of acts) {
    const o = (a ?? {}) as Record<string, unknown>;
    const type = ACTION_TYPES.find((t) => t === o.type);
    if (!type) {
      if (draft) continue;
      return { error: "An action is of a kind imbox does not know." };
    }
    if (type === "label" || type === "collection") {
      const id = str(o.id, 80);
      if (!id) {
        if (draft) continue;
        return { error: type === "label" ? "Pick a label for the action." : "Pick a collection for the action." };
      }
      actions.push({ type, id });
    } else if (type === "move") {
      const tray = TRAYS.find((t) => t === o.tray);
      if (!tray) {
        if (draft) continue;
        return { error: "Pick a tray to move mail to." };
      }
      actions.push({ type, tray });
    } else if (type === "snooze") {
      actions.push({ type, hours: clamp(o.hours, 1, LIMITS.maxHours, 24) });
    } else {
      actions.push({ type });
    }
  }

  const account_ids = Array.isArray(r.account_ids) ? [...new Set(r.account_ids.filter((x): x is string => typeof x === "string"))] : [];
  return {
    ok: {
      name,
      trigger,
      trigger_days: clamp(r.trigger_days, 1, LIMITS.maxDays, 3),
      match,
      conditions,
      actions,
      account_ids,
      daily_limit: clamp(r.daily_limit, 1, LIMITS.maxDaily, DEFAULT_DAILY),
    },
  };
}

/** A condition the AI decides. The rest are plain rules that need no model. */
export const isAiCondition = (c: Condition): boolean => c.field === "ai";

/** The parts of a message a condition can look at. */
export interface Facts {
  from_email: string;
  from_name: string;
  /** Every address on To and Cc. */
  recipients: string[];
  subject: string;
  body: string;
  has_attachment: boolean;
  has_unsubscribe: boolean;
  tray: string;
}

const lc = (s: string) => s.toLowerCase();

function textMatches(op: Op, hay: string[], needle: string, address = false): boolean {
  const n = lc(needle).trim();
  const hit = (h: string) => {
    const v = lc(h).trim();
    // "is" is the whole value; on an address, a name with no @ is a whole domain.
    if (op === "is") return v === n || (address && !n.includes("@") && v.endsWith(`@${n}`));
    return v.includes(n);
  };
  const any = hay.some(hit);
  return op === "not_contains" ? !any : any;
}

export function conditionHolds(c: Condition, f: Facts): boolean {
  switch (c.field) {
    case "from":
      // "contains" and "is" look at the address and the display name.
      if (c.op === "not_contains") return !textMatches("contains", [f.from_email, f.from_name], c.value);
      return textMatches(c.op, c.op === "is" ? [f.from_email] : [f.from_email, f.from_name], c.value, true);
    case "to":
      return textMatches(c.op, f.recipients, c.value, true);
    case "subject":
      return textMatches(c.op, [f.subject], c.value);
    case "body":
      return textMatches(c.op, [f.body], c.value);
    case "has_attachment":
      return f.has_attachment === (c.value !== "false");
    case "has_unsubscribe":
      return f.has_unsubscribe === (c.value !== "false");
    case "tray":
      return c.op === "not_contains" ? f.tray !== c.value : f.tray === c.value;
    case "ai":
      // Decided by the runner, which asks the model; here it is never a reason to match.
      return false;
  }
}

/** Does a message pass? With no conditions everything does (the no-reply trigger is limited by time, not by content). */
export function passes(conditions: Condition[], match: "all" | "any", f: Facts): boolean {
  if (!conditions.length) return true;
  return match === "any" ? conditions.some((c) => conditionHolds(c, f)) : conditions.every((c) => conditionHolds(c, f));
}

/** One line for a condition or an action, for the history and the screens. */
export function describeCondition(c: Condition): string {
  switch (c.field) {
    case "from":
      return c.op === "is" ? `sender is ${c.value}` : c.op === "not_contains" ? `sender does not contain "${c.value}"` : `sender contains "${c.value}"`;
    case "to":
      return c.op === "is" ? `sent to ${c.value}` : c.op === "not_contains" ? `not sent to "${c.value}"` : `sent to "${c.value}"`;
    case "subject":
      return c.op === "not_contains" ? `subject does not contain "${c.value}"` : c.op === "is" ? `subject is "${c.value}"` : `subject contains "${c.value}"`;
    case "body":
      return c.op === "not_contains" ? `text does not contain "${c.value}"` : c.op === "is" ? `text is "${c.value}"` : `text contains "${c.value}"`;
    case "has_attachment":
      return c.value === "false" ? "has no attachment" : "has an attachment";
    case "has_unsubscribe":
      return c.value === "false" ? "is not a mailing list" : "is a mailing list";
    case "tray":
      return c.op === "not_contains" ? `is not in ${c.value}` : `is in ${c.value}`;
    case "ai":
      return `the AI judges that it ${c.value}`;
  }
}
