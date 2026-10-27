// What the privacy page says, as data. The page draws it, and a test reads the code for every outside address it can contact and fails if one is
// missing here, so the page cannot quietly fall behind the app. Each entry was written from reading the code it describes.

/** The day this was last checked against the code. Change it when the entries are reviewed. */
export const CHECKED_ON = "October 3, 2026";

export interface Flow {
  id: string;
  /** Always: while the app runs. Optional: only if you connect it or turn it on. */
  when: "always" | "optional";
  title: string;
  /** Who is contacted, in words. */
  who: string;
  /** The addresses contacted, when they are fixed. Used for the allowlist and checked against the code. */
  hosts: string[];
  /** Where the request comes from. */
  from: "your server" | "your browser";
  /** What that party can see. */
  sees: string;
  why: string;
  /** How to stop it. */
  stop: string;
}

export const FLOWS: Flow[] = [
  {
    id: "updates",
    when: "always",
    title: "Checking for a new version",
    who: "GitHub",
    hosts: ["api.github.com"],
    from: "your browser",
    sees: "Your IP address, and that someone is running imbox. Never any mail, address or account name.",
    why: "To tell you when a newer release exists. It asks at most once every six hours and says nothing if it cannot connect.",
    stop: "Turn off \"Look for new versions\" in Settings, under Preferences and Privacy. Nothing else changes.",
  },
  {
    id: "pictures",
    when: "always",
    title: "Pictures of the people who write to you",
    who: "Gravatar, Cloudflare's public DNS, and the sender's own website",
    hosts: ["www.gravatar.com", "cloudflare-dns.com"],
    from: "your server",
    sees:
      "Gravatar sees a one-way hash of a sender's address (not the address itself) and your server's IP. Cloudflare's DNS sees the domain name of senders, such as example.com. A company's website sees your server fetching its icon. None of them sees you or your mail.",
    why: "So a message shows a face or a logo. Your browser never contacts any of them: pictures are fetched by your server and served back to you.",
    stop: "Turn off \"Pictures of senders\" in Settings, under Preferences and Privacy. Nobody is contacted, and people show as initials.",
  },
  {
    id: "mailbox",
    when: "optional",
    title: "Gmail and Outlook mailboxes",
    who: "Google, or Microsoft",
    hosts: ["www.googleapis.com", "gmail.googleapis.com", "people.googleapis.com", "oauth2.googleapis.com", "accounts.google.com", "graph.microsoft.com", "login.microsoftonline.com"],
    from: "your server",
    sees: "What they already hold: your mail, since it lives with them, and that your server is reading and sending it.",
    why: "To sync and send mail for a Gmail or Outlook account you connect. Other mailboxes (IMAP, your own domain) talk to their own mail server instead.",
    stop: "Do not connect one, or remove the mailbox. Removing it deletes what imbox synced and leaves the mailbox itself untouched.",
  },
  {
    id: "own-pictures",
    when: "optional",
    title: "Google contact photos, and the picture you choose",
    who: "Google, Gravatar, or the site of a picture address you paste",
    hosts: ["*.googleusercontent.com", "gravatar.com"],
    from: "your browser",
    sees: "Your IP address and which picture was asked for. The page that asked is never named, because no referrer is sent. Never any mail.",
    why: "With a Gmail account connected, the photos Google holds for you and your contacts are shown from Google's own address. The picture you pick in Settings, under Profile, is shown from where it lives: Gravatar, a link you paste, or your account's own. A picture you upload stays on your server and contacts nobody.",
    stop: "Upload your own picture instead of choosing Gravatar or a link. Google's contact photos load while a Gmail account is connected, and the switch for pictures of senders does not cover them yet.",
  },
  {
    id: "domain-sending",
    when: "optional",
    title: "Sending from your own domain through Resend",
    who: "Resend",
    hosts: ["api.resend.com"],
    from: "your server",
    sees: "Every message you send from a domain mailbox, with its recipients, subject, text and attachments, since Resend is the one that delivers it.",
    why: "To send mail from an address on your own domain, when you have set a Resend key on your server. A domain mailbox with a Stalwart server behind it sends through that instead.",
    stop: "Leave RESEND_API_KEY unset. Nothing is sent to Resend, and a domain mailbox then sends only through its own mail server.",
  },
  {
    id: "calendars",
    when: "optional",
    title: "Calendars you add",
    who: "Google, for a Google calendar, or the server behind any calendar link or CalDAV address you add",
    hosts: [],
    from: "your server",
    sees: "The address you gave and your server's IP. For CalDAV, also the account you sign in with, and your events, which that server already holds.",
    why: "To show those events beside your mail. Google calendars use the same connection as the mailbox; links and CalDAV servers are fetched by your server, which refuses addresses inside your own network.",
    stop: "Remove the calendar. A link or an uploaded file is only read, never changed.",
  },
  {
    id: "ai",
    when: "optional",
    title: "An AI model",
    who: "The company you chose: Anthropic, OpenAI, Google, xAI, OpenRouter, Groq, Together, Fireworks, Cerebras, DeepSeek, Mistral or Amazon Bedrock, or a model you run yourself. If you turn on fast decisions, TypeSafe AI as well",
    hosts: ["api.anthropic.com", "api.openai.com", "api.x.ai", "generativelanguage.googleapis.com", "openrouter.ai", "api.groq.com", "api.together.xyz", "api.fireworks.ai", "api.cerebras.ai", "api.deepseek.com", "api.mistral.ai", "bedrock-mantle.us-east-1.api.aws", "api.typesafe.ai"],
    from: "your server",
    sees: "The text each feature needs, listed below, and your API key. Their privacy terms apply to it, so read the ones for the model you pick.",
    why: "For the assistant and the features that read your mail for you. None of it runs until you add a key.",
    stop: "Remove the key, or switch single features off. A model on your own machine keeps all of it with you.",
  },
  {
    id: "push",
    when: "optional",
    title: "Notifications with the app closed",
    who: "Your browser's push service (Google, Apple or Mozilla)",
    hosts: [],
    from: "your server",
    sees: "An encrypted message that only your device can open. The push service sees its size and when it was sent, not the sender or the subject.",
    why: "To reach your phone or computer when imbox is not open.",
    stop: "Turn notifications off in Settings, or in your browser.",
  },
];

export const NEVER: { title: string; text: string }[] = [
  { title: "Analytics", text: "No analytics, advertising or tracking of any kind. Not in the page, the app, or the server." },
  { title: "Telemetry", text: "Nothing is sent to the people who make imbox: no usage, no crash reports, no counts." },
  { title: "Selling or sharing", text: "There is nobody to sell it to. The project has no servers that receive your mail, your address or your account." },
  { title: "Reading your mail", text: "The project cannot read it. Your mail is on your server, in your database, and nowhere the project can reach." },
  { title: "Sending for you", text: "Nothing is sent in your name unless you press send, or you set something up to do it: away notices (words you read and approved) or a mail agent you create." },
];

export interface AiInput {
  feature: string;
  sends: string;
}

export const AI_INPUTS: AiInput[] = [
  { feature: "The assistant", sends: "Your question, and the mail it looks up to answer it. Long messages are cut short." },
  { feature: "One-line summaries", sends: "The subject, the sender, and the first 3,500 characters of the message." },
  { feature: "Thread summaries and catch-up", sends: "The text of the thread: up to its last 20 messages, at most 6,000 characters each." },
  { feature: "Screener suggestions", sends: "A new sender's name and address, a few of their subject lines, a short snippet, and how you have sorted other senders before." },
  { feature: "Moving mail to the Imbox", sends: "The sender, the subject, a snippet, and about 500 characters of one message in Feed." },
  { feature: "The daily brief", sends: "Up to six waiting threads (subject, sender, a snippet, how old) and the meetings you have today." },
  { feature: "Events and to-dos", sends: "The text of a message, to find a meeting or a deadline in it." },
  { feature: "Learning from your mail", sends: "Mail you have sent, to learn your tone, sign-offs and facts that come up often. At most twice a day, and only if that switch is on." },
  { feature: "Search: reading your request", sends: "Only the words you typed into search and today's date, never any mail. When you press Search with a request in plain words, so it can be turned into filters." },
  { feature: "Search answers and overviews", sends: "The question or search you typed, and short excerpts (about 1,400 characters each, three per conversation) of the six conversations that match it. Only when you press Search with a question, or press Summarize on a result page." },
  { feature: "Finishing sentences in a reply", sends: "The end of the reply you are typing (up to 1,500 characters) and the first 1,500 characters of the email you are answering, its subject and who it is to, after a short pause in typing. Only when you switch it on under Settings, Writing." },
  { feature: "Mail agents", sends: "The mail each agent you create is set to handle, to draft or send a reply by the rules you gave it." },
  { feature: "Away notices", sends: "The day you are back, your name, who handles urgent things and the line you typed. No mail. The notices are written once, and what is sent later is the text you approved." },
];

export const PROTECTION: { title: string; text: string }[] = [
  { title: "Passwords", text: "Stored only as a salted PBKDF2-SHA256 hash with 100,000 rounds. The password itself is never kept." },
  { title: "Passkeys and two-step sign-in", text: "Sign in with a passkey, and add an authenticator app with recovery codes." },
  { title: "Your session", text: "One cookie. It cannot be read by scripts on the page, is only sent over HTTPS, and is not sent along with requests from other sites." },
  { title: "Keys and secrets", text: "AI keys and the sign-in secrets of your mail apps are encrypted before they are stored, with a key that only your server holds." },
  { title: "Mailbox tokens", text: "The sign-in tokens for a Gmail or Outlook mailbox sit in your database as they are. Protect the database as you would protect your mail." },
  { title: "Guessing", text: "Repeated wrong passwords and codes are slowed down, and a second-step ticket lasts five minutes and allows six tries." },
  { title: "The AI log", text: "The usage page counts calls: which feature, which model, how many tokens, how long. It never keeps the text that was sent or returned." },
];

/** The fixed addresses, grouped, as a firewall allowlist the person can paste. */
export function allowlist(flows: Flow[]): string {
  const block = (title: string, when: Flow["when"]) => {
    const lines = flows
      .filter((f) => f.when === when && f.hosts.length)
      .flatMap((f) => [`# ${f.title}${f.from === "your browser" ? " (from your browser)" : ""}`, ...f.hosts]);
    return [`# ${title}`, ...lines].join("\n");
  };
  return `${block("On its own", "always")}\n\n${block("Only if you connect or turn it on", "optional")}\n`;
}

