import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { StalwartDomain, StalwartMailbox, StalwartServer } from "@shared/types";
import { html, NOW } from "./render";
import SettingsPage from "@/pages/Settings";
import { AddDomainForm } from "@/stalwart/AddDomainForm";
import { ConnectServerForm } from "@/stalwart/ConnectServerForm";
import { CreateMailboxForm } from "@/stalwart/CreateMailboxForm";
import { MailboxesBlock } from "@/stalwart/MailboxesBlock";
import { ImportSelect } from "@/stalwart/Resync";
import { ServerHeader } from "@/stalwart/ServerHeader";
import { StalwartDomainRows } from "@/stalwart/StalwartDomainRows";
import { parseZoneFile } from "@/stalwart/zone";

// The Stalwart panels (connecting a mail server, its domains and mailboxes, the DNS records to publish), pinned before the file was split: the zone file
// reader on its own, then what the panels draw with a server connected.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const SERVER: StalwartServer = {
  id: "s-1",
  name: "Home server",
  base_url: "https://mail.chen.studio",
  imap_host: "mail.chen.studio",
  imap_port: 993,
  smtp_host: "mail.chen.studio",
  smtp_port: 465,
  api_key_hint: "••••k3y9",
  last_checked_at: NOW - 120_000,
  last_error: null,
  mailboxes: 3,
};
const DOMAINS: StalwartDomain[] = [
  { id: "sd-1", name: "chen.studio", isEnabled: true, description: "Main" },
  { id: "sd-2", name: "chen.example", isEnabled: false, description: null },
];
const MAILBOXES: StalwartMailbox[] = [
  { id: "sm-1", name: "maya", domain_id: "sd-1", domain: "chen.studio", email: "maya@chen.studio", description: "Maya", account_id: "a-imap", is_admin: false, is_agent: false },
  { id: "sm-2", name: "hello", domain_id: "sd-1", domain: "chen.studio", email: "hello@chen.studio", description: null, account_id: null, is_admin: false, is_agent: false },
  { id: "sm-3", name: "admin", domain_id: "sd-1", domain: "chen.studio", email: "admin@chen.studio", description: null, account_id: null, is_admin: true, is_agent: false },
  { id: "sm-4", name: "helper", domain_id: "sd-2", domain: "chen.example", email: "helper@chen.example", description: "Agent", account_id: "a-dom", is_admin: false, is_agent: true },
];
const connected = (qc: QueryClient) => {
  qc.setQueryData(["stalwart", "servers"], [SERVER]);
  qc.setQueryData(["stalwart", "s-1", "domains"], DOMAINS);
  qc.setQueryData(["stalwart", "s-1", "mailboxes"], MAILBOXES);
};
const noop = () => {};

const ZONE = `$ORIGIN chen.studio.
$TTL 3600
@ IN SOA ns1.chen.studio. admin.chen.studio. ( 1 7200 3600 1209600 3600 )
@ 3600 IN MX 10 mail.chen.studio.
@ IN TXT "v=spf1 mx -all"
mail IN A 203.0.113.7
mail.chen.studio. IN AAAA 2001:db8::7
www IN CNAME chen.studio.
default._domainkey IN TXT ( "v=DKIM1; k=rsa; "
   "p=MIIBIjANBgkqh" ) ; split across two strings
_dmarc.chen.studio. 600 IN TXT "v=DMARC1; p=quarantine"
_mta-sts IN TXT "v=STSv1; id=1"
_smtp._tls IN TXT "v=TLSRPTv1; rua=mailto:tls@chen.studio"
_25._tcp.mail IN TLSA 3 1 1 abcdef
autoconfig IN CNAME mail.chen.studio.
_imaps._tcp IN SRV 0 1 993 mail.chen.studio.
@ IN CAA 0 issue "letsencrypt.org"
@ IN NS ns1.chen.studio.
bogus IN WKS 1
; a comment line
tiny IN`;

describe("reading a zone file", () => {
  it("turns records into rows with a short name, a purpose and whether it is essential", () => {
    expect(parseZoneFile(ZONE, "chen.studio")).toMatchSnapshot();
  });
  it("keeps full names when it is not told the domain, and finds nothing in nothing", () => {
    expect(parseZoneFile(ZONE).map((r) => r.shortName)).toMatchSnapshot();
    expect(parseZoneFile("")).toEqual([]);
    expect(parseZoneFile("; only a comment\n$TTL 60")).toEqual([]);
  });
  it("joins a TXT value split over quoted strings and unescapes it", () => {
    const [r] = parseZoneFile('t IN TXT "a\\"b" "c\\\\d"', "x.test");
    expect(r.value).toBe('a"bc\\d');
  });
});

describe("the panels", () => {
  it("import choice", () => expect(html(<ImportSelect value={50} onChange={noop} />)).toMatchSnapshot());
  it("connect a server form", () => expect(html(<ConnectServerForm onConnected={noop} onCancel={noop} autoFocus />)).toMatchSnapshot());
  it("add a domain form", () => expect(html(<AddDomainForm serverId="s-1" onAdded={noop} onCancel={noop} />)).toMatchSnapshot());
  it("server header", () => expect(html(<ServerHeader server={SERVER} onForget={noop} />)).toMatchSnapshot());
  it("server header with an error", () => expect(html(<ServerHeader server={{ ...SERVER, last_error: "401 from the server", last_checked_at: null }} onForget={noop} />)).toMatchSnapshot());
  it("domains and mailboxes of a server", () => expect(html(<StalwartDomainRows server={SERVER} />, "/settings", connected)).toMatchSnapshot());
  it("domains and mailboxes while loading", () => expect(html(<StalwartDomainRows server={SERVER} />)).toMatchSnapshot());
  it("mailboxes of one domain", () => expect(html(<MailboxesBlock server={SERVER} domain="chen.studio" />, "/settings", connected)).toMatchSnapshot());
  it("mailboxes of a domain with an agent mailbox", () => expect(html(<MailboxesBlock server={SERVER} domain="chen.example" />, "/settings", connected)).toMatchSnapshot());
  it("every mailbox of a server, grouped by domain", () => expect(html(<MailboxesBlock server={SERVER} />, "/settings", connected)).toMatchSnapshot());
  it("no mailboxes yet", () =>
    expect(html(<MailboxesBlock server={SERVER} />, "/settings", (qc) => { connected(qc); qc.setQueryData(["stalwart", "s-1", "mailboxes"], []); })).toMatchSnapshot());
  it("new mailbox form", () => expect(html(<CreateMailboxForm serverId="s-1" domains={DOMAINS} onCreated={noop} onCancel={noop} />)).toMatchSnapshot());
  it("new mailbox form with no usable domain", () => expect(html(<CreateMailboxForm serverId="s-1" domains={[]} onCreated={noop} />)).toMatchSnapshot());
  it("the Domains tab with a server connected", () => expect(html(<SettingsPage />, "/settings?tab=domains", connected)).toMatchSnapshot());
  it("the Accounts tab with a server connected", () => expect(html(<SettingsPage />, "/settings?tab=accounts", connected)).toMatchSnapshot());
});
