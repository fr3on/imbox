import { useEffect } from "react";
import { Navigate, Route, Routes, } from "react-router-dom";
import { Shell } from "./components/Shell";
import { page, warm } from "./lib/lazy";
import Imbox from "./pages/Imbox";

const Feed = page(() => import("./pages/Feed"));
const Screener = page(() => import("./pages/Screener"));
const ReplyLater = page(() => import("./pages/ReplyLater"));
const SetAside = page(() => import("./pages/SetAside"));
const BubbleUp = page(() => import("./pages/BubbleUp"));
const ListPage = page(() => import("./pages/ListPage"));
const Sent = page(() => import("./pages/Sent"));
const ScreenedOut = page(() => import("./pages/ScreenedOut"));
const Thread = page(() => import("./pages/Thread"));
const ComposePage = page(() => import("./pages/Compose"));
const Drafts = page(() => import("./pages/Drafts"));
const Contacts = page(() => import("./pages/Contacts"));
const ContactDetail = page(() => import("./pages/ContactDetail"));
const ContactByEmail = page(() => import("./pages/ContactByEmail"));
const BundlePage = page(() => import("./pages/BundlePage"));
const Clips = page(() => import("./pages/Clips"));
const Logs = page(() => import("./pages/Logs"));
const Workflows = page(() => import("./pages/Workflows"));
const Workflow = page(() => import("./pages/Workflow"));
const WorkflowNew = page(() => import("./pages/WorkflowNew"));
const Collections = page(() => import("./pages/Collections"));
const CollectionDetail = page(() => import("./pages/CollectionDetail"));
const FilesPage = page(() => import("./pages/Files"));
const Labels = page(() => import("./pages/Labels"));
const LabelThreads = page(() => import("./pages/LabelThreads"));
const SettingsPage = page(() => import("./pages/Settings"));
const Assistant = page(() => import("./pages/Assistant"));
const AiUsage = page(() => import("./pages/AiUsage"));
const CalendarPage = page(() => import("./pages/Calendar"));
const SearchPage = page(() => import("./pages/Search"));
const NotFound = page(() => import("./pages/NotFound"));
const Welcome = page(() => import("./pages/Welcome"));

/** The pages nearly every session reaches. Fetched once the first paint is out of the way. */
const COMMON = [Thread, Feed, Screener, ReplyLater, SetAside, SearchPage, SettingsPage, CalendarPage];

export default function DesktopApp() {
  useEffect(() => warm(COMMON), []);
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Imbox />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/updates" element={<Navigate to="/feed" replace />} />
        <Route path="/paper-trail" element={<Navigate to="/feed?kind=receipts" replace />} />
        <Route path="/screener" element={<Screener />} />
        <Route path="/screened-out" element={<ScreenedOut />} />
        <Route path="/reply-later" element={<ReplyLater />} />
        <Route path="/set-aside" element={<SetAside />} />
        <Route path="/bubble-up" element={<BubbleUp />} />
        <Route path="/previously-seen" element={<ListPage key="seen" bucket="previously_seen" title="Previously seen" subtitle="Everything you've already looked at." />} />
        <Route path="/trash" element={<ListPage key="trash" bucket="trash" title="Trash" subtitle="Gone, but not forgotten. Yet." />} />
        <Route path="/sent" element={<Sent key="sent" />} />
        <Route path="/everything" element={<ListPage key="everything" bucket="everything" title="Everything" subtitle="All your mail, every bucket, one list." showBucket />} />
        <Route path="/labels" element={<Labels />} />
        <Route path="/labels/:id" element={<LabelThreads />} />
        <Route path="/t/:id" element={<Thread />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/drafts" element={<Drafts mode="draft" />} />
        <Route path="/scheduled" element={<Drafts mode="scheduled" />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/email/:email" element={<ContactByEmail />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/bundle/:id" element={<BundlePage />} />
        <Route path="/clips" element={<Clips />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/new" element={<WorkflowNew />} />
        <Route path="/workflows/:id" element={<Workflow />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/collections/:id" element={<CollectionDetail />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/assistant/:id" element={<Assistant />} />
        <Route path="/ai-usage" element={<AiUsage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/more" element={<Imbox />} />
      </Route>
      {/* Outside the signed-in app: an address that leads nowhere looks the same to everyone. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
