import { useEffect, useState } from "react";
import { BrandIcon } from "../components/BrandIcons";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useScreenedOut, useUpdateContact } from "../api";
import { useAccount } from "../context/AccountContext";
import { fmtTime } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useItemCursor } from "../lib/cardKeys";
import { cn } from "@/lib/utils";

export default function ScreenedOut() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  // Wait for a pause in typing before asking the server, and go back to the first page for a new search.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const q = useScreenedOut(term, page);
  const nav = useNavigate();
  const update = useUpdateContact();
  const { toast } = useToast();
  const { multi } = useAccount();
  const contacts = q.data?.contacts ?? [];
  const total = q.data?.total ?? 0;
  const pages = q.data?.pages ?? 1;
  const pageSize = q.data?.page_size ?? 50;
  // The server clamps the page (e.g. after the last sender on it was let in); follow it.
  useEffect(() => {
    if (q.data && q.data.page !== page) setPage(q.data.page);
  }, [q.data, page]);
  const { cursor } = useItemCursor({ count: contacts.length, onOpen: (i) => contacts[i] && nav(`/contacts/${contacts[i].id}`) });
  const admit = (c: (typeof contacts)[number], status: "imbox" | "feed" | "paper_trail", label: string) =>
    update.mutate({ id: c.id, screen_status: status }, { onSuccess: () => toast(`${c.name || c.email} → ${label}`, { kind: "success" }) });
  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader
        className="px-2"
        title="Screened out"
        subtitle={total ? `${total} ${total === 1 ? "sender" : "senders"} ${term ? "match" : "you said no to. Change your mind any time."}` : "People you said no to. Change your mind any time."}
        actions={
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link to="/screener">
              <BrandIcon name="not-now" /> Screener
            </Link>
          </Button>
        }
      />
      <div className="relative mx-2 mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id="screened-out-search" type="search" aria-label="Search screened out senders" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
      </div>
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <SkeletonRows compact />}
      {!q.isLoading && contacts.length === 0 && !q.error && !term && <EmptyState icon={<BrandIcon name="not-now" />} title="Nobody's screened out." body="Say no in the Screener and they'll be listed here." />}
      {!q.isLoading && contacts.length === 0 && !q.error && term && <EmptyState icon={<BrandIcon name="not-now" />} title="No matches." body={`No screened out sender matches “${term}”.`} />}
      {contacts.length > 0 && (
        <ul>
          {contacts.map((c, i) => {
            const mailboxes = c.accounts.length;
            return (
              <li key={c.id} data-item-index={i} data-focused={cursor === i || undefined} className={cn("group relative flex items-center gap-3 px-2 h-11 rounded-md scroll-mt-20 hover:bg-accent", cursor === i && "bg-muted")}>
                {cursor === i && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-foreground" />}
                <Avatar email={c.email} name={c.name} src={c.avatar_url} size={20} />
                <Link to={`/contacts/${c.id}`} className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-sm truncate">{c.name || c.email}</span>
                  {multi && mailboxes > 1 && <span className="text-xs text-muted-foreground tnum">{mailboxes} mailboxes</span>}
                  <span className="text-xs text-muted-foreground truncate tnum hidden sm:inline">
                    {c.name ? `${c.email} · ` : ""}
                    {c.message_count} message{c.message_count === 1 ? "" : "s"}
                    {c.screened_at ? ` · screened out ${fmtTime(c.screened_at)}` : ""}
                  </span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={update.isPending && update.variables?.id === c.id}>
                      Let them in <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Deliver their mail to</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => admit(c, "imbox", "Imbox")}>
                      <BrandIcon name="imbox" /> Imbox
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => admit(c, "feed", "Feed")}>
                      <BrandIcon name="feed" /> Feed
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-2 py-3 text-xs text-muted-foreground tnum">
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1 || q.isPlaceholderData} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft /> Previous
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages || q.isPlaceholderData} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight />
            </Button>
          </span>
        </nav>
      )}
    </div>
  );
}
