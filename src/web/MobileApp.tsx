import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { page, warm } from "./lib/lazy";
import MobileImbox from "./mobile/MobileImbox";
import { MobilePageWrap } from "./mobile/MobilePageWrap";
import { MobileShell } from "./mobile/MobileShell";

const MobileFeed = page(() => import("./mobile/MobileFeed"));
const MobileScreener = page(() => import("./mobile/MobileScreener"));
const MobileThread = page(() => import("./mobile/MobileThread"));
const MobileMore = page(() => import("./mobile/MobileMore"));
const MobileCalendar = page(() => import("./mobile/MobileCalendar"));
const MobileDay = page(() => import("./mobile/MobileDay"));
const MobileBundle = page(() => import("./mobile/MobileBundle"));
const MobileContacts = page(() => import("./mobile/MobileContacts"));
const MobileSent = page(() => import("./mobile/MobileSent"));

// The bucket screens share one module; the wrapper looks each bucket's config up inside the chunk,
// so BUCKETS itself does not have to be imported here (which would pull the whole module in eagerly).
const lists = () => import("./mobile/MobileListScreen");
const MobileBucket = page(() =>
  lists().then((m) => ({
    default: ({ bucket, back }: { bucket: string; back?: boolean }) => <m.MobileBucketScreen bucket={bucket} back={back} cfg={m.BUCKETS[bucket]} />,
  })),
);
const MobileLabelThreads = page(() => lists().then((m) => ({ default: m.MobileLabelThreads })));
const MobileSearch = page(() => lists().then((m) => ({ default: m.MobileSearch })));

const settings = () => import("./mobile/MobileSettings");
const MobileSettings = page(settings);
const MobileSettingsProfile = page(() => settings().then((m) => ({ default: m.MobileSettingsProfile })));
const MobileSettingsPreferences = page(() => settings().then((m) => ({ default: m.MobileSettingsPreferences })));
const MobileSettingsWriting = page(() => settings().then((m) => ({ default: m.MobileSettingsWriting })));
const MobileSettingsAccounts = page(() => settings().then((m) => ({ default: m.MobileSettingsAccounts })));
const MobileSettingsAccountDetail = page(() => settings().then((m) => ({ default: m.MobileSettingsAccountDetail })));
const MobileSettingsDomains = page(() => settings().then((m) => ({ default: m.MobileSettingsDomains })));
const MobileSettingsDomainDetail = page(() => settings().then((m) => ({ default: m.MobileSettingsDomainDetail })));
const MobileSettingsSecurity = page(() => settings().then((m) => ({ default: m.MobileSettingsSecurity })));
const MobileSettingsAi = page(() => settings().then((m) => ({ default: m.MobileSettingsAi })));

const assistant = () => import("./mobile/MobileAssistant");
const MobileAssistantList = page(() => assistant().then((m) => ({ default: m.MobileAssistantList })));
const MobileAssistantChat = page(() => assistant().then((m) => ({ default: m.MobileAssistantChat })));

// Shared with the desktop app, and a separate chunk in both.
const ScreenedOut = page(() => import("./pages/ScreenedOut"));
const Labels = page(() => import("./pages/Labels"));
const ComposePage = page(() => import("./pages/Compose"));
const Drafts = page(() => import("./pages/Drafts"));
const ContactDetail = page(() => import("./pages/ContactDetail"));
const Clips = page(() => import("./pages/Clips"));
const Logs = page(() => import("./pages/Logs"));
const Workflows = page(() => import("./pages/Workflows"));
const Workflow = page(() => import("./pages/Workflow"));
const WorkflowNew = page(() => import("./pages/WorkflowNew"));
const Collections = page(() => import("./pages/Collections"));
const CollectionDetail = page(() => import("./pages/CollectionDetail"));
const FilesPage = page(() => import("./pages/Files"));
const AiUsage = page(() => import("./pages/AiUsage"));
const NotFound = page(() => import("./pages/NotFound"));
const Welcome = page(() => import("./pages/Welcome"));

/** The screens a phone session reaches most. Fetched once the first paint is out of the way. */
const COMMON = [MobileThread, MobileFeed, MobileScreener, MobileMore, MobileSearch];

export default function MobileApp() {
  useEffect(() => warm(COMMON), []);
  const wrap = (title: string, el: React.ReactNode, tabs = true) => <MobilePageWrap title={title} tabs={tabs}>{el}</MobilePageWrap>;
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route element={<MobileShell />}>
        <Route path="/" element={<MobileImbox />} />
        <Route path="/feed" element={<MobileFeed />} />
        <Route path="/updates" element={<Navigate to="/feed" replace />} />
        <Route path="/paper-trail" element={<Navigate to="/feed?kind=receipts" replace />} />
        <Route path="/screener" element={<MobileScreener />} />
        <Route path="/more" element={<MobileMore />} />
        <Route path="/calendar" element={<MobileCalendar />} />
        <Route path="/calendar/:date" element={<MobileDay />} />
        <Route path="/screened-out" element={wrap("", <ScreenedOut />)} />
        <Route path="/reply-later" element={<MobileBucket key="rl" bucket="reply_later" back />} />
        <Route path="/set-aside" element={<MobileBucket key="sa" bucket="set_aside" back />} />
        <Route path="/bubble-up" element={<MobileBucket key="bu" bucket="bubble_up" back />} />
        <Route path="/previously-seen" element={<MobileBucket key="ps" bucket="previously_seen" back />} />
        <Route path="/trash" element={<MobileBucket key="tr" bucket="trash" back />} />
        <Route path="/sent" element={<MobileSent key="se" />} />
        <Route path="/everything" element={<MobileBucket key="ev" bucket="everything" back />} />
        <Route path="/labels" element={wrap("", <Labels />)} />
        <Route path="/labels/:id" element={<MobileLabelThreads />} />
        <Route path="/t/:id" element={<MobileThread />} />
        <Route path="/compose" element={wrap("", <ComposePage />, false)} />
        <Route path="/drafts" element={wrap("", <Drafts mode="draft" />)} />
        <Route path="/scheduled" element={wrap("", <Drafts mode="scheduled" />)} />
        <Route path="/contacts" element={<MobileContacts />} />
        <Route path="/contacts/:id" element={wrap("", <ContactDetail />)} />
        <Route path="/bundle/:id" element={<MobileBundle />} />
        <Route path="/clips" element={wrap("", <Clips />)} />
        <Route path="/logs" element={wrap("", <Logs />)} />
        <Route path="/workflows" element={wrap("", <Workflows />)} />
        <Route path="/workflows/new" element={wrap("", <WorkflowNew />)} />
        <Route path="/workflows/:id" element={wrap("", <Workflow />)} />
        <Route path="/collections" element={wrap("", <Collections />)} />
        <Route path="/collections/:id" element={wrap("", <CollectionDetail />)} />
        <Route path="/files" element={wrap("", <FilesPage />)} />
        <Route path="/settings" element={<MobileSettings />} />
        <Route path="/settings/profile" element={<MobileSettingsProfile />} />
        <Route path="/settings/preferences" element={<MobileSettingsPreferences />} />
        <Route path="/settings/writing" element={<MobileSettingsWriting />} />
        <Route path="/settings/accounts" element={<MobileSettingsAccounts />} />
        <Route path="/settings/accounts/:id" element={<MobileSettingsAccountDetail />} />
        <Route path="/settings/domains" element={<MobileSettingsDomains />} />
        <Route path="/settings/domains/:id" element={<MobileSettingsDomainDetail />} />
        <Route path="/settings/security" element={<MobileSettingsSecurity />} />
        <Route path="/settings/ai" element={<MobileSettingsAi />} />
        <Route path="/assistant" element={<MobileAssistantList />} />
        <Route path="/assistant/:id" element={<MobileAssistantChat />} />
        <Route path="/ai-usage" element={wrap("AI Usage", <AiUsage />)} />
        <Route path="/search" element={<MobileSearch />} />
      </Route>
      {/* Outside the signed-in app: an address that leads nowhere looks the same to everyone. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
