import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersonPeek } from "../api";
import { fmtTime } from "../lib/format";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

const WHERE: Record<string, { label: string; icon: React.ReactNode }> = {
  imbox: { label: "Their mail goes to the Imbox", icon: <BrandIcon name="imbox" /> },
  feed: { label: "Their mail goes to Feed", icon: <BrandIcon name="feed" /> },
  paper_trail: { label: "Their mail goes to Feed", icon: <BrandIcon name="paper-trail" /> },
  screened_out: { label: "Screened out", icon: <BrandIcon name="not-now" /> },
  pending: { label: "Waiting in the Screener", icon: <BrandIcon name="screener" /> },
  mixed: { label: "Their mail goes to different places", icon: <BrandIcon name="sender" /> },
};

interface Person {
  email: string;
  name?: string;
  avatar_url?: string;
}

function Card({ person, onOpen }: { person: Person; onOpen: () => void }) {
  const nav = useNavigate();
  const q = usePersonPeek(person.email, true);
  const d = q.data;
  const name = d?.name || person.name || person.email.split("@")[0];
  const where = d?.known && d.screen_status ? WHERE[d.screen_status] : null;
  return (
    <div className="w-72 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar email={person.email} name={name} src={d?.avatar_url || person.avatar_url} size={44} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-5">{name}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">{person.email}</div>
        </div>
      </div>
      {where && (
        <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-[12.5px] [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
          {where.icon}
          {where.label}
        </div>
      )}
      {d?.known ? (
        <div className="text-xs text-muted-foreground tnum">
          {d.message_count} {d.message_count === 1 ? "message" : "messages"}
          {d.first_seen_at ? ` · first wrote ${fmtTime(d.first_seen_at)}` : ""}
          {d.last_seen_at ? ` · last ${fmtTime(d.last_seen_at)}` : ""}
        </div>
      ) : q.isSuccess ? (
        <div className="text-xs text-muted-foreground">Not in your contacts yet.</div>
      ) : null}
      {d?.note && <p className="line-clamp-2 rounded-md border border-border/60 px-2.5 py-1.5 text-[12.5px] leading-4 text-foreground/80">{d.note}</p>}
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="outline" onClick={onOpen}>
          <BrandIcon name="sender" /> Open contact
        </Button>
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => nav(`/search?q=${encodeURIComponent(`from:${person.email}`)}`)}>
          <BrandIcon name="search" /> Their mail
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps an avatar so that hovering shows who this is: name, address, where their mail goes and how much they have written; clicking opens
 * their contact page. Nothing is fetched until the card opens. On a touch screen a tap goes straight to the contact.
 */
export function PersonCard({ person, children }: { person: Person; children: React.ReactNode }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const openContact = () => nav(`/contacts/email/${encodeURIComponent(person.email)}?name=${encodeURIComponent(person.name ?? "")}`);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={350} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          role="link"
          tabIndex={0}
          aria-label={`${person.name || person.email}: open contact`}
          className="cursor-pointer rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => {
            // The avatar often sits inside a row that is itself a link; this click is about the person, not the row.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            openContact();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              openContact();
            }
          }}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-auto p-3" onClick={(e) => e.stopPropagation()}>
        {open && (
          <Card
            person={person}
            onOpen={() => {
              setOpen(false);
              openContact();
            }}
          />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
