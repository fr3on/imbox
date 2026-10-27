import type Anthropic from "@anthropic-ai/sdk";

const BUCKETS = ["imbox", "feed", "paper_trail", "screener", "screened_out", "trash", "reply_later", "set_aside", "bubble_up", "sent", "everything", "previously_seen"] as const;

function obj(properties: Record<string, unknown>, required: string[] = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false } as const;
}
const str = (description: string) => ({ type: "string", description });
const nstr = (description: string) => ({ type: ["string", "null"], description });
const nint = (description: string) => ({ type: ["integer", "null"], description });

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_mail",
    description: "Search across the user's mail with full-text search and rich filters: unread status, attachments, date range, sender, recipient, label, and mailbox bucket (where it lives).",
    strict: true,
    input_schema: obj({
      query: nstr("Search words or keywords to match in subject, body, snippet, or notes"),
      unread_only: { type: ["boolean", "null"], description: "Only return unread/unseen threads" },
      has_attachment: { type: ["boolean", "null"], description: "Only return threads that have file attachments" },
      from_sender: nstr("Filter by sender name or email address"),
      to_recipient: nstr("Filter by recipient email address"),
      label: nstr("Filter by label name or label id"),
      bucket: {
        type: ["string", "null"],
        enum: ["imbox", "feed", "paper_trail", "screener", "screened_out", "trash", "reply_later", "set_aside", null],
        description: "Where the mail lives: imbox, feed, paper_trail, screener, screened_out, trash, reply_later, set_aside",
      },
      since_date: nstr("Start date YYYY-MM-DD (threads active on or after this date)"),
      until_date: nstr("End date YYYY-MM-DD (threads active on or before this date)"),
      limit: nint("Max results (default 10, max 25)"),
    }),
  },
  { name: "list_threads", description: "List threads in a box. Buckets: imbox (new + previously seen), feed, paper_trail, screener, screened_out, trash, reply_later, set_aside, bubble_up, sent, everything, previously_seen.", strict: true, input_schema: obj({ bucket: { type: "string", enum: [...BUCKETS] }, limit: nint("Max results (default 15, max 40)"), only_new: { type: ["boolean", "null"], description: "imbox only: return just the 'New for you' threads" } }) },
  { name: "read_thread", description: "Read a thread: participants and messages with plain-text bodies (trimmed). Use before summarising or replying.", strict: true, input_schema: obj({ thread_id: str("Thread id"), max_messages: nint("Max messages to return, newest first (default 20)") }) },
  { name: "list_screener", description: "Senders waiting in the Screener with what they sent.", strict: true, input_schema: obj({}) },
  { name: "screen_sender", description: "Decide a Screener sender: let them into imbox / feed / paper_trail, or screen them out. Reversible later.", strict: true, input_schema: obj({ contact_id: str("Contact id from list_screener or find_contact"), decision: { type: "string", enum: ["imbox", "feed", "paper_trail", "screened_out"] } }) },
  {
    name: "thread_action",
    description: "Organise a thread. actions: reply_later, set_aside (toggle on/off with `on`), bubble_up (needs `at` epoch ms; null cancels), move (needs `bucket`: imbox|feed|paper_trail|trash), mark_read, mark_unread, label_add / label_remove (needs `label_id`), bundle (toggle sender bundling with `on`), unsubscribe_info (returns the unsubscribe link for newsletters).",
    strict: true,
    input_schema: obj({
      thread_id: str("Thread id"),
      action: { type: "string", enum: ["reply_later", "set_aside", "bubble_up", "move", "mark_read", "mark_unread", "label_add", "label_remove", "bundle", "unsubscribe_info"] },
      on: { type: ["boolean", "null"], description: "For reply_later / set_aside / bundle (default true)" },
      bucket: { type: ["string", "null"], enum: ["imbox", "feed", "paper_trail", "trash", null], description: "For move" },
      at: nint("For bubble_up: epoch milliseconds when it should come back"),
      label_id: nstr("For label_add / label_remove"),
    }),
  },
  { name: "list_labels", description: "The user's labels (id, name).", strict: true, input_schema: obj({}) },
  { name: "list_collections", description: "The user's collections (id, name, thread count).", strict: true, input_schema: obj({}) },
  { name: "create_collection", description: "Create a collection (a named bundle of related threads).", strict: true, input_schema: obj({ name: str("Collection name"), description: nstr("Optional one-line description") }) },
  { name: "add_to_collection", description: "Add a thread to a collection.", strict: true, input_schema: obj({ thread_id: str("Thread id"), collection_id: str("Collection id") }) },
  { name: "save_clip", description: "Save a short piece of text from a thread (a code, address, sentence) to the user's Clips.", strict: true, input_schema: obj({ thread_id: str("Thread id"), text: str("The exact text to clip (max 500 chars)") }) },
  { name: "find_contact", description: "Find people by name or email among the user's contacts and address book.", strict: true, input_schema: obj({ query: str("Name or email fragment"), limit: nint("Max results (default 8)") }) },
  {
    name: "create_draft",
    description: "Write an email as a draft for the user to review. mode: new (needs `to` + `subject`), reply (to the thread's last sender), reply_all, forward (needs `to`). Body is plain text; paragraphs separated by blank lines. The user decides whether to send. Returns a draft id.",
    strict: true,
    input_schema: obj({
      mode: { type: "string", enum: ["new", "reply", "reply_all", "forward"] },
      thread_id: nstr("Thread id for reply / reply_all / forward. Required for those: use the id from the [[context thread=…]] block, list_threads or read_thread."),
      to: { type: ["array", "null"], items: { type: "string" }, description: "Recipient emails (new / forward). Null for replies." },
      cc: { type: ["array", "null"], items: { type: "string" }, description: "CC emails" },
      subject: nstr("Subject (new mail; replies/forwards derive it when null)"),
      body_text: str("The email text, in the user's voice"),
      account_id: nstr("From account id (null = the thread's account or the default account)"),
    }),
  },
  { name: "send_draft", description: "Send a draft. Only works when the user allowed autonomous sending; otherwise the user must press Send themselves.", strict: true, input_schema: obj({ draft_id: str("Draft id from create_draft") }) },
  { name: "list_memory", description: "What you currently remember about the user (ids included).", strict: true, input_schema: obj({}) },
  { name: "remember", description: "Store a durable fact, preference, tone note, or contact note about the user. Keep it to one concise sentence.", strict: true, input_schema: obj({ kind: { type: "string", enum: ["profile", "tone", "fact", "preference", "contact"] }, content: str("One sentence") }) },
  { name: "forget", description: "Delete a memory entry by id.", strict: true, input_schema: obj({ id: str("Memory id") }) },
  {
    name: "list_events",
    description: "List calendar events for a date range (defaults to today and the upcoming 7 days). Returns event titles, times, all-day flags, locations, attendees, and calendars.",
    strict: true,
    input_schema: obj({
      from: nstr("Start date YYYY-MM-DD (defaults to today)"),
      to: nstr("End date YYYY-MM-DD (defaults to 7 days after start date)"),
      limit: nint("Max events to return (default 25, max 50)"),
    }),
  },
  {
    name: "find_free_time",
    description: "Find available free time slots on a given date or range within working hours. Useful for scheduling meetings or checking availability.",
    strict: true,
    input_schema: obj({
      from_date: str("Start date YYYY-MM-DD"),
      to_date: nstr("End date YYYY-MM-DD (defaults to from_date)"),
      duration_minutes: nint("Required duration in minutes (default 30)"),
      start_hour: nint("Working day start hour, 24-hr (default 9 for 9:00 AM)"),
      end_hour: nint("Working day end hour, 24-hr (default 17 for 5:00 PM)"),
    }),
  },
  {
    name: "propose_event",
    description: "Propose a calendar event for the user to review and confirm. Emits an event proposal card in the chat that lets the user add it directly or open the prefilled calendar sheet. Does not add the event without user confirmation.",
    strict: true,
    input_schema: obj({
      title: str("Event title"),
      date: str("Date YYYY-MM-DD"),
      start_time: nstr("Start time HH:MM in 24-hour format (e.g. '14:30'). Omit for all-day events."),
      end_time: nstr("End time HH:MM in 24-hour format (e.g. '15:30'). If omitted, duration_minutes is used."),
      duration_minutes: nint("Duration in minutes (default 30) if end_time not provided"),
      all_day: { type: ["boolean", "null"], description: "Whether this is an all-day event (default false)" },
      location: nstr("Location or meeting link"),
      description: nstr("Notes, description or agenda"),
      attendees: { type: ["array", "null"], items: { type: "string" }, description: "Attendee email addresses" },
      calendar_id: nstr("Calendar id (optional, defaults to default calendar)"),
    }),
  },
  {
    name: "draft_workflow",
    description:
      "Draft a workflow for the user to review: a rule that acts on mail on its own. A workflow has a trigger (message_arrives, or no_reply: a thread the user wrote has had no reply for trigger_days), conditions on the email, and up to five actions. Conditions: from, to, subject, body (op contains, not_contains or is; 'is' on from or to is a whole address or a whole domain), has_attachment and has_unsubscribe (op is, value 'true' or 'false'), tray (op is or not_contains, value imbox, feed or paper_trail), ai (op is; value finishes 'this email ...', such as 'is a receipt'; use only when words and addresses cannot say it). Actions: label (name an existing label), collection (name an existing collection), move (tray), mark_read, set_aside, reply_later, snooze (hours). There is no action that deletes, sends, forwards or replies. Shows a card; nothing is saved or switched on until the user chooses to, so never say it is saved. Use match 'any' when the user lists alternatives.",
    strict: true,
    input_schema: obj({
      name: str("A short name for the workflow"),
      trigger: { type: "string", enum: ["message_arrives", "no_reply"] },
      trigger_days: nint("For no_reply: days without a reply (default 3)"),
      match: { type: "string", enum: ["all", "any"] },
      conditions: {
        type: "array",
        items: obj({
          field: { type: "string", enum: ["from", "to", "subject", "body", "has_attachment", "has_unsubscribe", "tray", "ai"] },
          op: { type: "string", enum: ["contains", "not_contains", "is"] },
          value: str("What to look for"),
        }),
      },
      actions: {
        type: "array",
        items: obj({
          type: { type: "string", enum: ["label", "collection", "move", "mark_read", "set_aside", "reply_later", "snooze"] },
          tray: { type: ["string", "null"], enum: ["imbox", "feed", "paper_trail", null] },
          label: nstr("For label: the name of one of the user's labels"),
          collection: nstr("For collection: the name of one of the user's collections"),
          hours: nint("For snooze: hours until it comes back"),
        }),
      },
      notes: nstr("One or two short sentences for the user: what this does, and anything you left out or are unsure of"),
    }),
  },
  {
    name: "get_daily_brief",
    description: "Get the daily brief: what needs the user today (priority emails waiting for replies or decisions, and today's schedule/meetings). Answers 'What needs me today?' or 'Give me my morning brief'.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "catch_up_thread",
    description: "Catch up on what changed in an email thread: what was said, agreed, or decided in recent messages, and what is currently asked of the user. Answers 'Catch me up on this' or 'What changed in this thread?'.",
    strict: true,
    input_schema: obj({
      thread_id: nstr("Thread id (defaults to the currently focused or attached thread)"),
      recent: { type: ["boolean", "null"], description: "If true, summarize the latest messages even if not unread (default true)" },
    }),
  },
  {
    name: "find_thread_actions",
    description: "Find asks, deadlines, tasks, and proposed meetings pulled out of an email thread, or find upcoming deadlines and to-dos across recent mail. Answers 'what does this ask of me?', 'what are my deadlines?', or 'what is due this week?'.",
    strict: true,
    input_schema: obj({
      thread_id: nstr("Specific thread id to check for asks/deadlines (optional: if omitted, checks across active mail and candidate threads)"),
      kind: {
        type: ["string", "null"],
        enum: ["all", "deadline", "task", "event", null],
        description: "Filter by kind: deadline, task, event, or all",
      },
    }),
  },
  {
    name: "set_contact_destination",
    description: "Set where mail from a contact or sender goes: 'imbox' (priority/focus), 'feed' (newsletters/reads), 'paper_trail' (receipts/notifications), or 'screened_out' (blocked). Can identify contact by email address or contact_id.",
    strict: true,
    input_schema: obj({
      email: nstr("Contact email address"),
      contact_id: nstr("Contact ID (optional if email provided)"),
      destination: {
        type: "string",
        enum: ["imbox", "feed", "paper_trail", "screened_out"],
        description: "Where mail from this contact belongs",
      },
      scope: {
        type: ["string", "null"],
        enum: ["all", "account", null],
        description: "Scope of the change: 'all' applies to all user accounts (default), 'account' applies only to the specific account",
      },
    }),
  },
  {
    name: "bundle_sender",
    description: "Set whether mail from a sender or contact should be bundled together in the Feed / Paper Trail or listed individually. Can identify contact by email address or contact_id.",
    strict: true,
    input_schema: obj({
      email: nstr("Contact email address"),
      contact_id: nstr("Contact ID (optional if email provided)"),
      bundled: { type: "boolean", description: "Whether to bundle this sender's messages together" },
      scope: {
        type: ["string", "null"],
        enum: ["all", "account", null],
        description: "Scope of the change: 'all' (default) or 'account'",
      },
    }),
  },
  {
    name: "list_noisy_or_misfiled_senders",
    description: "List senders that may be noisy (high volume of emails cluttering the Imbox) or misfiled (AI recommendations where newsletters, receipts, or personal emails are in the wrong bucket). Answers 'Which senders are noisy?' or 'Are there any misfiled senders?'.",
    strict: true,
    input_schema: obj({
      kind: {
        type: ["string", "null"],
        enum: ["all", "noisy", "misfiled", null],
        description: "Filter by 'noisy', 'misfiled', or 'all' (default)",
      },
      limit: nint("Maximum number of senders to return (default 10)"),
    }),
  },
  {
    name: "bulk_thread_action",
    description: "Propose or perform a bulk action across multiple threads (e.g. move newsletters to Feeds, mark receipts as read, move to trash). By default (confirm=false), it generates a preview confirmation card showing affected threads for the user to review and confirm or undo.",
    strict: true,
    input_schema: obj({
      action: {
        type: "string",
        enum: ["move", "mark_read", "mark_unread", "reply_later", "set_aside", "trash"],
        description: "Bulk action to perform",
      },
      bucket: nstr("Target bucket when action is 'move' (imbox, feed, paper_trail, trash)"),
      thread_ids: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Specific thread IDs to apply action to (optional if search criteria provided)",
      },
      query: nstr("Search query to find threads for bulk action"),
      from_sender: nstr("Sender email or name to filter threads"),
      current_bucket: nstr("Current bucket to filter within (e.g. 'imbox', 'feed', 'paper_trail')"),
      unread_only: { type: ["boolean", "null"], description: "Whether to only target unread threads" },
      limit: nint("Maximum number of threads to affect (default 20, max 100)"),
      confirm: {
        type: ["boolean", "null"],
        description: "If true, executes the action immediately (with an undo card). If false (default), proposes the action with a confirmation card first.",
      },
    }),
  },
  {
    name: "undo_bulk_action",
    description: "Undo a previous bulk action by restoring threads to their previous bucket or status. Can provide thread_ids and restore_action or restore_bucket.",
    strict: true,
    input_schema: obj({
      thread_ids: { type: "array", items: { type: "string" }, description: "Thread IDs to restore" },
      restore_action: {
        type: "string",
        enum: ["move", "mark_unread", "mark_read", "reply_later_off", "set_aside_off"],
        description: "Action to perform to undo",
      },
      restore_bucket: nstr("Bucket to restore threads into (if restore_action is 'move')"),
    }),
  },
];
