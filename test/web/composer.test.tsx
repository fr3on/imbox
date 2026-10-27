import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AttachmentItem,
  AUTOSAVE_DELAY,
  Composer,
  fileIcon,
  MAX_ATTACH,
  savedLabel,
  SIG_STYLE,
  ToolButton,
  type Att,
  type SaveState,
} from "@/components/Composer";
import { html, NOW } from "./render";

// The sanitiser needs a real DOM, which node/server render tests do not have; what it makes of a message is not what is pinned here.
vi.mock("@/lib/sanitizeHtml", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sanitizeEmailHtml: (h: string) => h }));

// Characterization tests for Composer: the editor, attachments, recipients, drafts, and signature.
// Pinned before splitting Composer.tsx into Composer/ modules.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

describe("savedLabel", () => {
  const now = NOW;

  it("returns empty string when idle", () => {
    expect(savedLabel({ kind: "idle" }, now)).toBe("");
  });

  it("returns Saving… while saving", () => {
    expect(savedLabel({ kind: "saving" }, now)).toBe("Saving…");
  });

  it("returns error message when save failed", () => {
    expect(savedLabel({ kind: "error", message: "Network error" }, now)).toBe("Couldn't save draft");
  });

  it("says Saved within 8 seconds", () => {
    expect(savedLabel({ kind: "saved", at: now - 3000 }, now)).toBe("Saved");
    expect(savedLabel({ kind: "saved", at: now - 7000 }, now)).toBe("Saved");
  });

  it("says seconds ago between 8 and 59 seconds", () => {
    expect(savedLabel({ kind: "saved", at: now - 8000 }, now)).toBe("Saved 8s ago");
    expect(savedLabel({ kind: "saved", at: now - 45000 }, now)).toBe("Saved 45s ago");
  });

  it("says minutes ago after 60 seconds", () => {
    expect(savedLabel({ kind: "saved", at: now - 60000 }, now)).toBe("Saved 1m ago");
    expect(savedLabel({ kind: "saved", at: now - 180000 }, now)).toBe("Saved 3m ago");
  });
});

describe("fileIcon", () => {
  it("renders image icon for image mime types", () => {
    const icon = fileIcon("image/png");
    expect(icon).toBeDefined();
  });

  it("renders archive icon for zip/tar/etc or extensions", () => {
    expect(fileIcon("application/zip")).toBeDefined();
    expect(fileIcon("application/octet-stream", "bundle.tar.gz")).toBeDefined();
    expect(fileIcon("application/octet-stream", "archive.7z")).toBeDefined();
  });

  it("renders text/doc icon for pdf, text, document, sheet, csv", () => {
    expect(fileIcon("application/pdf")).toBeDefined();
    expect(fileIcon("text/plain")).toBeDefined();
    expect(fileIcon("text/csv")).toBeDefined();
  });

  it("renders fallback file icon for other types", () => {
    expect(fileIcon("application/octet-stream", "binary.dat")).toBeDefined();
  });
});

describe("constants", () => {
  it("has a 20 MB attachment cap", () => {
    expect(MAX_ATTACH).toBe(20 * 1024 * 1024);
  });

  it("uses grey signature style that travels with the email", () => {
    expect(SIG_STYLE).toBe("color:#8a8a8a");
  });

  it("uses an 1800ms debounce before autosaving", () => {
    expect(AUTOSAVE_DELAY).toBe(1800);
  });
});

describe("AttachmentItem", () => {
  it("renders filename and formatted size", () => {
    const a: Att = {
      filename: "proposal.pdf",
      mime_type: "application/pdf",
      size: 1024 * 250,
      data_base64: "AAAA",
    };
    const out = html(<AttachmentItem a={a} onRemove={() => {}} />);
    expect(out).toContain("proposal.pdf");
    expect(out).toContain("250 KB");
    expect(out).toContain("Remove attachment");
  });
});

describe("ToolButton", () => {
  it("renders button with label and aria-label", () => {
    const out = html(
      <ToolButton label="Bold" kbd="⌘B" onClick={() => {}}>
        <span>B</span>
      </ToolButton>,
    );
    expect(out).toContain('aria-label="Bold"');
    expect(out).toContain("<span>B</span>");
  });
});

describe("Composer rendering", () => {
  it("renders new message composer with header, inputs, and toolbar", () => {
    const out = html(<Composer />);
    expect(out).toMatchSnapshot();
    expect(out).toContain("From");
    expect(out).toContain("To");
    expect(out).toContain("Cc");
    expect(out).toContain("Bcc");
    expect(out).toContain("Subject");
    expect(out).toContain("Send");
    expect(out).toContain("Send later");
    expect(out).toContain("Attach files");
    expect(out).toContain("Bold");
    expect(out).toContain("Italic");
    expect(out).toContain("Underline");
  });

  it("renders reply composer with quoted text toggle", () => {
    const out = html(
      <Composer
        initial={{
          thread_id: "t-123",
          reply_to_message_id: "m-456",
          to: [{ email: "maya@example.com", name: "Maya" }],
          subject: "Re: Project Roadmap",
          quoted_html: "<p>Original message from Maya</p>",
        }}
      />,
    );
    expect(out).toMatchSnapshot();
    expect(out).toContain("Show quoted text");
    expect(out).toContain("Include when sending");
    expect(out).toContain("Re: Project Roadmap");
  });

  it("renders page layout with close button, title and formatting hint", () => {
    const out = html(
      <Composer
        page
        initial={{
          title: "Draft Announcement",
          subject: "New feature launch",
        }}
      />,
    );
    expect(out).toMatchSnapshot();
    expect(out).toContain("Close and keep as a draft");
    expect(out).toContain("Draft Announcement");
    expect(out).toContain("New feature launch");
    expect(out).toContain("Select text to format it.");
  });
});
