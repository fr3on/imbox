import { describe, expect, it } from "vitest";
import type {
  Account,
  Address,
  AgentEvent,
  AgentKey,
  AgentKeyCreated,
  AgentMailbox,
  AiBulkActionProposal,
  AiBulkThreadItem,
  AiCheckResponse,
  AiCheckResult,
  AiConversation,
  AiDraftCard,
  AiEventProposal,
  AiMemoryEntry,
  AiMemoryKind,
  AiPreset,
  AiSettings,
  AiUsageData,
  ApiError,
  Attachment,
  AutoAgentMemoryKind,
  AutoLetIn,
  Bucket,
  Bundle,
  BundleDetail,
  CalEvent,
  Calendar,
  CalendarDay,
  CalendarRange,
  CalendarSettings,
  CalendarSourcesResponse,
  CalendarView,
  Clip,
  Collection,
  Contact,
  Counts,
  DayCover,
  DecisionScope,
  Domain,
  Draft,
  EventAttendee,
  EventKind,
  GoogleCalendarAccount,
  ImboxResponse,
  Label,
  MergedContact,
  Message,
  Reminder,
  Rsvp,
  ScreenStatus,
  StalwartDomain,
  StalwartMailbox,
  StalwartMailboxCreated,
  StalwartServer,
  ThreadDetail,
  ThreadSummary,
  TwoFactorStatus,
  User,
  UserSettings,
  VacationSettings,
} from "@shared/types";
import type { User as DomainUser } from "@shared/types/common";
import type { ThreadSummary as DomainThreadSummary } from "@shared/types/mail";
import type { CalEvent as DomainCalEvent } from "@shared/types/calendar";
import type { StalwartServer as DomainStalwartServer } from "@shared/types/stalwart";
import type { AiSettings as DomainAiSettings } from "@shared/types/assistant";
import type { AgentKey as DomainAgentKey } from "@shared/types/agents";

describe("shared/types characterization", () => {
  it("imports and constructs all core types without error", () => {
    const user: User = {
      id: "u1",
      email: "test@example.com",
      name: "Test User",
      disabled: false,
      settings: {},
      created_at: 1000,
    };
    const domainUser: DomainUser = user;
    expect(domainUser.id).toBe("u1");

    const bucket: Bucket = "imbox";
    const status: ScreenStatus = "pending";
    expect(bucket).toBe("imbox");
    expect(status).toBe("pending");

    const account: Account = {
      id: "acc_1",
      email: "acc@example.com",
      display_name: "Account",
      provider: "gmail",
      domain_id: null,
      initial_sync_done: true,
      initial_sync_count: 10,
      sync_status: "idle",
      sync_error: null,
      last_synced_at: 1000,
      signature: "",
      cover_art: "",
      avatar_url: "",
      photos_synced_at: null,
      created_at: 1000,
    };
    expect(account.provider).toBe("gmail");

    const address: Address = { email: "a@b.com", name: "A B" };
    expect(address.email).toBe("a@b.com");

    const label: Label = { account_id: "acc_1", id: "l1", name: "Work", color: "#f00" };
    expect(label.name).toBe("Work");

    const summary: ThreadSummary = {
      account_id: "acc_1",
      id: "t1",
      subject: "Hello",
      original_subject: "Hello",
      snippet: "World",
      bucket: "imbox",
      seen: true,
      unread: false,
      reply_later: false,
      set_aside: false,
      bubble_up_at: null,
      bubbled: false,
      note: "",
      has_attachments: false,
      trackers_blocked: 0,
      participants: [address],
      last_from: address,
      message_count: 1,
      first_message_at: 1000,
      last_message_at: 1000,
      labels: [label],
    };
    const domainSummary: DomainThreadSummary = summary;
    expect(domainSummary.subject).toBe("Hello");

    const calEvent: Partial<CalEvent> = {
      id: "ev1",
      title: "Meeting",
      starts_at: 1000,
      ends_at: 2000,
      kind: "event",
    };
    const domainCalEvent: Partial<DomainCalEvent> = calEvent;
    expect(domainCalEvent.title).toBe("Meeting");

    const server: Partial<DomainStalwartServer> = { id: "srv1", name: "Local Stalwart" };
    expect(server.name).toBe("Local Stalwart");

    const aiSettings: Partial<DomainAiSettings> = { configured: true, model: "claude-3-5-sonnet" };
    expect(aiSettings.configured).toBe(true);

    const agentKey: Partial<DomainAgentKey> = { id: "k1", prefix: "ak_live" };
    expect(agentKey.prefix).toBe("ak_live");
  });
});
