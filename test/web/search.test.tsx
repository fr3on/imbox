import { beforeEach, describe, expect, it } from "vitest";
import { html } from "./render";
import SearchPage, {
  EXAMPLES,
  fileIcon,
  fmtSize,
  readRecent,
  RECENT_KEY,
  rememberSearch,
} from "@/pages/Search";
import { keys } from "@/api/keys";

describe("search formatting helpers", () => {
  it("formats file sizes cleanly across bytes, kilobytes, and megabytes", () => {
    expect(fmtSize(0)).toBe("0 B");
    expect(fmtSize(500)).toBe("500 B");
    expect(fmtSize(1023)).toBe("1023 B");
    expect(fmtSize(1024)).toBe("1 KB");
    expect(fmtSize(1536)).toBe("2 KB");
    expect(fmtSize(1024 * 1024)).toBe("1.0 MB");
    expect(fmtSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("chooses the appropriate icon for file mime types and extensions", () => {
    const img = html(fileIcon("image/jpeg", "photo.jpg"));
    expect(img).toContain("text-sky-600");

    const pdf = html(fileIcon("application/pdf", "doc.pdf"));
    expect(pdf).toContain("text-red-600");

    const sheet = html(fileIcon("text/csv", "data.csv"));
    expect(sheet).toContain("text-emerald-600");

    const generic = html(fileIcon("application/octet-stream", "data.bin"));
    expect(generic).toContain("text-muted-foreground");
  });

  it("manages recent searches in localStorage with deduplication and cap", () => {
    localStorage.removeItem(RECENT_KEY);
    expect(readRecent()).toEqual([]);

    rememberSearch("first");
    rememberSearch("second");
    rememberSearch("third");
    expect(readRecent()).toEqual(["third", "second", "first"]);

    // Deduplication moves query to front
    rememberSearch("first");
    expect(readRecent()).toEqual(["first", "third", "second"]);

    // Capped at 6 items
    for (let i = 1; i <= 10; i++) {
      rememberSearch(`query-${i}`);
    }
    const recents = readRecent();
    expect(recents).toHaveLength(6);
    expect(recents[0]).toBe("query-10");
  });

  it("provides non-empty examples array", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
    expect(EXAMPLES).toContain("invoices from last month");
  });
});

describe("SearchPage zero state", () => {
  beforeEach(() => {
    localStorage.removeItem(RECENT_KEY);
  });

  it("renders zero state when no query is present", () => {
    const out = html(<SearchPage />, "/search");
    expect(out).toContain("Search everything in inbox");
    expect(out).toContain("Try asking");
    for (const example of EXAMPLES) {
      expect(out).toContain(example);
    }
    expect(out).toContain("⌘K");
  });

  it("renders recent searches in zero state when present", () => {
    rememberSearch("quarterly taxes");
    const out = html(<SearchPage />, "/search");
    expect(out).toContain("Recent searches");
    expect(out).toContain("quarterly taxes");
  });
});

describe("SearchPage query states and tabs", () => {
  it("renders search input, category tabs, and order toggles when query is provided", () => {
    const out = html(<SearchPage />, "/search?q=invoice");
    expect(out).toContain('value="invoice"');
    expect(out).toContain("Mail");
    expect(out).toContain("People");
    expect(out).toContain("Files");
    expect(out).toContain("Best match");
    expect(out).toContain("Newest");
  });

  it("renders contacts tab with contact cards when seeded in cache", () => {
    const mockContact = {
      id: "cnt1",
      email: "billing@acme.com",
      name: "Acme Billing",
      notes: "Accounting contact",
      avatar_url: null,
      message_count: 14,
      screen_status: "in_imbox",
      last_seen: Date.now(),
    };
    const out = html(<SearchPage />, "/search?q=billing&tab=contacts", (qc) => {
      qc.setQueryData(keys.search("billing", "best", false, false), {
        pages: [
          {
            threads: [],
            contacts: [mockContact],
            files: [],
            events: [],
            counts: { threads: 0, contacts: 1, files: 0, events: 0, total: 1 },
            next_page: null,
          },
        ],
        pageParams: [0],
      });
    });
    expect(out).toContain("Acme Billing");
    expect(out).toContain("billing@acme.com");
    expect(out).toContain("14 messages");
    expect(out).toContain("Accounting contact");
  });

  it("renders files tab with file cards and download link when seeded in cache", () => {
    const mockFile = {
      id: "att1",
      message_id: "msg1",
      thread_id: "thr1",
      filename: "invoice_2026.pdf",
      mime_type: "application/pdf",
      size: 250 * 1024,
      thread_subject: "March Invoice",
      from: { email: "billing@acme.com", name: "Acme" },
    };
    const out = html(<SearchPage />, "/search?q=invoice&tab=files", (qc) => {
      qc.setQueryData(keys.search("invoice", "best", false, false), {
        pages: [
          {
            threads: [],
            contacts: [],
            files: [mockFile],
            events: [],
            counts: { threads: 0, contacts: 0, files: 1, events: 0, total: 1 },
            next_page: null,
          },
        ],
        pageParams: [0],
      });
    });
    expect(out).toContain("invoice_2026.pdf");
    expect(out).toContain("250 KB");
    expect(out).toContain("in March Invoice");
    expect(out).toContain("Download");
    expect(out).toContain("View thread");
  });

  it("renders events tab with calendar event card when seeded in cache", () => {
    const mockEvent = {
      id: "ev1",
      title: "Budget Review",
      starts_at: 1774000000000,
      ends_at: 1774003600000,
      all_day: false,
      location: "Room 402",
      description: "Q1 numbers discussion",
      calendar_color: "#3d6c56",
    };
    const out = html(<SearchPage />, "/search?q=budget&tab=events", (qc) => {
      qc.setQueryData(keys.search("budget", "best", false, false), {
        pages: [
          {
            threads: [],
            contacts: [],
            files: [],
            events: [mockEvent],
            counts: { threads: 0, contacts: 0, files: 0, events: 1, total: 1 },
            next_page: null,
          },
        ],
        pageParams: [0],
      });
    });
    expect(out).toContain("Budget Review");
    expect(out).toContain("Room 402");
    expect(out).toContain("Q1 numbers discussion");
  });

  it("renders empty states for tabs when there are no matches", () => {
    const emptyContacts = html(<SearchPage />, "/search?q=empty&tab=contacts", (qc) => {
      qc.setQueryData(keys.search("empty", "best", false, false), {
        pages: [{ threads: [], contacts: [], files: [], events: [], next_page: null }],
        pageParams: [0],
      });
    });
    expect(emptyContacts).toContain("No contacts matched “empty”");

    const emptyFiles = html(<SearchPage />, "/search?q=empty&tab=files", (qc) => {
      qc.setQueryData(keys.search("empty", "best", false, false), {
        pages: [{ threads: [], contacts: [], files: [], events: [], next_page: null }],
        pageParams: [0],
      });
    });
    expect(emptyFiles).toContain("No files matched “empty”");

    const emptyEvents = html(<SearchPage />, "/search?q=empty&tab=events", (qc) => {
      qc.setQueryData(keys.search("empty", "best", false, false), {
        pages: [{ threads: [], contacts: [], files: [], events: [], next_page: null }],
        pageParams: [0],
      });
    });
    expect(emptyEvents).toContain("No calendar events matched “empty”");
  });
});
