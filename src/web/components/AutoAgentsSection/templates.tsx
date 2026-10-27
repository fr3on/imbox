import React from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  FileEdit,
  KeyRound,
  Lightbulb,
  Loader2,
  PenLine,
  Send,
  ShieldAlert,
} from "lucide-react";
import { BrandIcon } from "../BrandIcons";
import type { AutoAgentMemoryKind, AutoAgentRun } from "../../api";

export const TEMPLATES: { label: string; text: string }[] = [
  {
    label: "Scheduling",
    text: "You handle meeting requests. If someone proposes a time, reply that it works when I am free on weekdays between 10:00 and 17:00 and suggest two alternatives if not. Keep it to two or three sentences. Never agree to anything outside those hours, and do not discuss anything except scheduling.",
  },
  {
    label: "Support inbox",
    text: "You answer questions from customers. Reply politely and briefly, using only what is written in these instructions. If the question needs an account lookup, a refund, or anything not covered here, do not reply: put the thread in Reply Later and say why.",
  },
  {
    label: "Triage only",
    text: "Do not write replies. Read each email and organise the thread: newsletters and receipts move out of the Imbox, anything that needs my decision goes to Reply Later.",
  },
];

export const STATUS: Record<AutoAgentRun["status"], { label: string; icon: typeof Send; tone: string }> = {
  replied: { label: "Replied", icon: Send, tone: "text-foreground" },
  drafted: { label: "Drafted", icon: FileEdit, tone: "text-foreground" },
  acted: { label: "Organised", icon: Check, tone: "text-muted-foreground" },
  skipped: { label: "Left alone", icon: Check, tone: "text-muted-foreground" },
  error: { label: "Problem", icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-500" },
  running: { label: "Working", icon: Loader2, tone: "text-muted-foreground" },
};

export const AGENT_MEMORY_KINDS: AutoAgentMemoryKind[] = ["faq", "rule", "fact", "tone", "contact"];

export const KIND_LABEL: Record<AutoAgentMemoryKind, string> = {
  faq: "Knowledge & FAQs",
  rule: "Rules & Policies",
  fact: "Facts & Context",
  tone: "Tone & Voice",
  contact: "People & Routing",
};

export const KIND_PLACEHOLDER: Record<AutoAgentMemoryKind, string> = {
  faq: "e.g. Password reset link is https://example.com/reset-password",
  rule: "e.g. If customer asks for refund over $50, put in Reply Later and do not reply",
  fact: "e.g. Business hours are Mon-Fri 9:00 - 17:00 EST; response time within 24h",
  tone: "e.g. Keep replies polite and concise. Sign off with: Best regards, Support Team",
  contact: "e.g. Senders from @acme.com are VIP clients: flag for review",
};

export const MEMORY_TEMPLATES: { label: string; icon: React.ReactNode; kind: AutoAgentMemoryKind; text: string }[] = [
  {
    label: "Password reset link",
    icon: <KeyRound />,
    kind: "faq",
    text: "Password reset link: Direct users to https://example.com/reset-password to reset their password.",
  },
  {
    label: "Business hours",
    icon: <Clock />,
    kind: "fact",
    text: "Support hours are Monday to Friday, 9:00 AM to 5:00 PM EST. Urgent requests outside hours are queued.",
  },
  {
    label: "Escalation policy",
    icon: <ShieldAlert />,
    kind: "rule",
    text: "If a customer asks for a refund, account deletion, or legal inquiry, do not reply: put the thread in Reply Later.",
  },
  {
    label: "Sign-off and tone",
    icon: <PenLine />,
    kind: "tone",
    text: "Keep replies friendly and under 3 sentences. Sign off with: Best regards, Support Team",
  },
];

export const AGENT_KIND_ICON: Record<AutoAgentMemoryKind, React.ReactNode> = {
  faq: <BookOpen />,
  rule: <ShieldAlert />,
  fact: <Lightbulb />,
  tone: <PenLine />,
  contact: <BrandIcon name="sender" />,
};

export const AGENT_KIND_HINT: Record<AutoAgentMemoryKind, string> = {
  faq: "Answers to questions it gets often",
  rule: "What it must and must not do",
  fact: "Background it should know",
  tone: "How it should sound",
  contact: "Who is who, and where they go",
};
