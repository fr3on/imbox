

interface ImapPreset {
  id: string;
  name: string;
  imapHost: string;
  smtpHost: string;
  imapPort: number;
  smtpPort: number;
  hint: string;
  guide?: {
    title: string;
    steps: { text: string; link?: { url: string; label: string } }[];
  };
}

export const IMAP_PRESETS: ImapPreset[] = [
  {
    id: "custom",
    name: "Custom / Domain",
    imapHost: "",
    smtpHost: "",
    imapPort: 993,
    smtpPort: 465,
    hint: "Enter your email. Server names will auto-fill as mail.<your-domain>.",
  },
  {
    id: "gmail",
    name: "Gmail",
    imapHost: "imap.gmail.com",
    smtpHost: "smtp.gmail.com",
    imapPort: 993,
    smtpPort: 465,
    hint: "Sign in with a 16-character Google App Password.",
    guide: {
      title: "How to generate a Google App Password:",
      steps: [
        {
          text: "Make sure 2-Step Verification is turned ON in your Google Account.",
          link: { url: "https://myaccount.google.com/security", label: "Google Security" },
        },
        {
          text: "Create a 16-letter App Password for 'Mail'.",
          link: { url: "https://myaccount.google.com/apppasswords", label: "Generate App Password" },
        },
        { text: "Copy the 16-letter code and paste it in the Password field below." },
      ],
    },
  },
  {
    id: "fastmail",
    name: "Fastmail",
    imapHost: "imap.fastmail.com",
    smtpHost: "smtp.fastmail.com",
    imapPort: 993,
    smtpPort: 465,
    hint: "Create an app password in Fastmail under Settings → Privacy & Security.",
  },
  {
    id: "icloud",
    name: "iCloud",
    imapHost: "imap.mail.me.com",
    smtpHost: "smtp.mail.me.com",
    imapPort: 993,
    smtpPort: 587,
    hint: "Generate an app-specific password at appleid.apple.com under Sign-In & Security.",
    guide: {
      title: "Apple App-Specific Password:",
      steps: [
        {
          text: "Go to Apple Account Security and generate an app-specific password.",
          link: { url: "https://appleid.apple.com/account/manage", label: "Apple ID Portal" },
        },
        { text: "Use your full @icloud.com, @me.com, or @mac.com address below." },
      ],
    },
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    imapHost: "imap.zoho.com",
    smtpHost: "smtp.zoho.com",
    imapPort: 993,
    smtpPort: 465,
    hint: "Use your Zoho password or generate an application password in Zoho accounts.",
  },
  {
    id: "migadu",
    name: "Migadu",
    imapHost: "imap.migadu.com",
    smtpHost: "smtp.migadu.com",
    imapPort: 993,
    smtpPort: 465,
    hint: "Use your standard Migadu mailbox address and password.",
  },
];
