import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { AiSettings } from "@shared/types";
import type { AutoAgent, AutoAgentMemoryItem, AutoAgentRun } from "@/api";
import { html, NOW } from "./render";
import {
  ActivityPage,
  AgentMemoryPage,
  AutoAgentsSection,
  Editor,
  MEMORY_TEMPLATES,
  RunLine,
  STATUS,
  TEMPLATES,
} from "@/components/AutoAgentsSection";

vi.mock("@/components/ui/dialog", async (orig) => {
  const actual = await orig<typeof import("@/components/ui/dialog")>();
  return {
    ...actual,
    DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-slot="dialog-content" className={className}>{children}</div>
    ),
    DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <h2 data-slot="dialog-title" className={className}>{children}</h2>
    ),
    DialogDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <p data-slot="dialog-description" className={className}>{children}</p>
    ),
    DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-slot="dialog-header" className={className}>{children}</div>
    ),
    DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-slot="dialog-footer" className={className}>{children}</div>
    ),
  };
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const RUNS: AutoAgentRun[] = [
  { id: "r-1", agent_id: "ag-1", thread_id: "t-1", status: "replied", summary: "Answered hours", draft_id: null, subject: "When are you open?", from_email: "alice@example.com", created_at: NOW - 600_000 },
  { id: "r-2", agent_id: "ag-1", thread_id: "t-2", status: "drafted", summary: "Prepared reply", draft_id: "d-1", subject: "Quote request", from_email: "bob@example.com", created_at: NOW - 1_200_000 },
  { id: "r-3", agent_id: "ag-1", thread_id: "t-3", status: "acted", summary: "Moved to Reply Later", draft_id: null, subject: "Refund question", from_email: "charlie@example.com", created_at: NOW - 1_800_000 },
  { id: "r-4", agent_id: "ag-1", thread_id: "t-4", status: "skipped", summary: "Newsletter", draft_id: null, subject: "Weekly digest", from_email: "news@example.com", created_at: NOW - 2_400_000 },
  { id: "r-5", agent_id: "ag-1", thread_id: "t-5", status: "error", summary: "Provider timeout", draft_id: null, subject: "Urgent fix", from_email: "dan@example.com", created_at: NOW - 3_000_000 },
  { id: "r-6", agent_id: "ag-1", thread_id: "t-6", status: "running", summary: "", draft_id: null, subject: "Hello", from_email: "eve@example.com", created_at: NOW - 10_000 },
];

const AGENT_1: AutoAgent = {
  id: "ag-1",
  name: "Support Bot",
  instructions: "Answer politely and briefly.",
  account_ids: ["a-gmail"],
  mode: "draft",
  enabled: true,
  only_screened_in: true,
  senders: "",
  daily_limit: 20,
  last_run_at: NOW - 300_000,
  replies_today: 5,
  recent: RUNS.slice(0, 3),
  memory_count: 2,
};

const AGENT_2: AutoAgent = {
  id: "ag-2",
  name: "Triage Assistant",
  instructions: "Organise incoming threads.",
  account_ids: ["a-imap"],
  mode: "auto",
  enabled: false,
  only_screened_in: false,
  senders: "vip@example.com",
  daily_limit: 50,
  last_run_at: null,
  replies_today: 0,
  recent: [],
  memory_count: 0,
};

const MEMORIES: AutoAgentMemoryItem[] = [
  { id: "m-1", agent_id: "ag-1", kind: "faq", content: "Password reset link is https://example.com/reset", source: "user", created_at: NOW - 86_400_000, updated_at: NOW - 86_400_000 },
  { id: "m-2", agent_id: "ag-1", kind: "rule", content: "Never issue refunds over $100 without manager approval.", source: "learned", created_at: NOW - 40_000_000, updated_at: NOW - 40_000_000 },
];

const seed = (opts: { agents?: AutoAgent[]; aiConfigured?: boolean; runs?: AutoAgentRun[]; skippedCount?: number; memories?: AutoAgentMemoryItem[] } = {}) => (qc: QueryClient) => {
  qc.setQueryData(["auto-agents"], opts.agents ?? []);
  qc.setQueryData(["ai", "settings"], { configured: opts.aiConfigured !== false } as AiSettings);
  if (opts.runs !== undefined) {
    qc.setQueryData(["auto-agents", "ag-1", "runs", false], { runs: opts.runs, skipped_count: opts.skippedCount ?? 0 });
    qc.setQueryData(["auto-agents", "ag-1", "runs", true], { runs: opts.runs, skipped_count: opts.skippedCount ?? 0 });
  }
  if (opts.memories !== undefined) {
    qc.setQueryData(["auto-agents", "ag-1", "memory"], opts.memories);
  }
};

describe("AutoAgentsSection", () => {
  it("renders empty state when there are no agents", () => {
    const out = html(<AutoAgentsSection />, "/settings", seed({ agents: [] }));
    expect(out).toMatchSnapshot();
    expect(out).toContain("No agents yet");
    expect(out).toContain("Try one that handles meeting requests");
  });

  it("shows warning when AI provider is not configured", () => {
    const out = html(<AutoAgentsSection />, "/settings", seed({ agents: [], aiConfigured: false }));
    expect(out).toContain("Agents use your AI provider, and none is set up yet.");
    expect(out).toContain("Set it up under AI");
  });

  it("renders list of configured agents with status, counts and actions", () => {
    const out = html(<AutoAgentsSection />, "/settings", seed({ agents: [AGENT_1, AGENT_2] }));
    expect(out).toMatchSnapshot();
    expect(out).toContain("Support Bot");
    expect(out).toContain("Drafts for review");
    expect(out).toContain("Running");
    expect(out).toContain("5 of 20 replies today");
    expect(out).toContain("Triage Assistant");
    expect(out).toContain("Sends by itself");
    expect(out).toContain("Off");
    expect(out).toContain("Memory");
    expect(out).toContain("Activity");
  });
});

describe("ActivityPage", () => {
  it("renders agent activity with each run status and icon", () => {
    const out = html(<ActivityPage agent={AGENT_1} onBack={() => {}} />, "/settings", seed({ runs: RUNS, skippedCount: 4 }));
    expect(out).toMatchSnapshot();
    expect(out).toContain("Support Bot · activity");
    expect(out).toContain("Replied");
    expect(out).toContain("Drafted");
    expect(out).toContain("Organised");
    expect(out).toContain("Left alone");
    expect(out).toContain("Problem");
    expect(out).toContain("Working");
    expect(out).toContain("Also show the 4 it left alone");
  });

  it("renders empty activity state when no runs exist", () => {
    const out = html(<ActivityPage agent={AGENT_1} onBack={() => {}} />, "/settings", seed({ runs: [], skippedCount: 0 }));
    expect(out).toContain("Nothing yet. It looks at new mail about once a minute.");
  });
});

describe("AgentMemoryPage", () => {
  it("renders empty memory state with starter templates", () => {
    const out = html(<AgentMemoryPage agent={AGENT_1} onBack={() => {}} />, "/settings", seed({ memories: [] }));
    expect(out).toMatchSnapshot();
    expect(out).toContain("Support Bot · memory");
    expect(out).toContain("Nothing taught yet");
    expect(out).toContain("Password reset link");
    expect(out).toContain("Business hours");
    expect(out).toContain("Escalation policy");
    expect(out).toContain("Sign-off and tone");
  });

  it("renders taught memories grouped with kinds, counts, and sources", () => {
    const out = html(<AgentMemoryPage agent={AGENT_1} onBack={() => {}} />, "/settings", seed({ memories: MEMORIES }));
    expect(out).toMatchSnapshot();
    expect(out).toContain("Support Bot · memory");
    expect(out).toContain("Knowledge &amp; FAQs");
    expect(out).toContain("Rules &amp; Policies");
    expect(out).toContain("Password reset link is https://example.com/reset");
    expect(out).toContain("Never issue refunds over $100 without manager approval.");
    expect(out).toContain("Learned");
    expect(out).toContain("You");
  });
});

describe("Editor dialog", () => {
  it("renders dialog for creating new agent with instructions templates", () => {
    const out = html(<Editor agent={null} open onClose={() => {}} />, "/settings", seed());
    expect(out).toMatchSnapshot();
    expect(out).toContain("New agent");
    expect(out).toContain("Mailboxes it watches");
    expect(out).toContain("Write a draft for me to review");
    expect(out).toContain("Send replies by itself");
    expect(out).toContain("Only people I have screened in");
    expect(out).toContain("Scheduling");
    expect(out).toContain("Support inbox");
    expect(out).toContain("Triage only");
    expect(out).toContain("Try it");
  });

  it("renders dialog for editing an existing agent with prefilled data", () => {
    const out = html(<Editor agent={AGENT_1} open onClose={() => {}} />, "/settings", seed());
    expect(out).toMatchSnapshot();
    expect(out).toContain("Edit agent");
    expect(out).toContain("Support Bot");
    expect(out).toContain("Answer politely and briefly.");
  });
});

describe("static templates and constants", () => {
  it("has predefined agent instructions templates", () => {
    expect(TEMPLATES.map((t) => t.label)).toEqual(["Scheduling", "Support inbox", "Triage only"]);
  });

  it("has predefined memory templates", () => {
    expect(MEMORY_TEMPLATES.map((t) => t.label)).toEqual([
      "Password reset link",
      "Business hours",
      "Escalation policy",
      "Sign-off and tone",
    ]);
  });

  it("has labels for all run statuses", () => {
    expect(Object.keys(STATUS)).toEqual(["replied", "drafted", "acted", "skipped", "error", "running"]);
  });
});
