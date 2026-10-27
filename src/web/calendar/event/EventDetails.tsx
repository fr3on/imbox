import { Link } from "react-router-dom";
import { Check, Download, Mail, Video } from "lucide-react";
import type { Rsvp } from "@shared/types";
import { Button } from "@/components/ui/button";
import { eventIcsUrl, useEventMutations } from "@/api";
import { openExternalUrl } from "@/lib/native";
import { meetingLink } from "@shared/meeting";
import type { CalEvent, EventAttendee } from "@shared/types";
import { RSVP_LABEL } from "./fields";

export function EventDetails({ ev, myInvite, readOnly, m, closeEditor }: { ev: CalEvent | null; myInvite: EventAttendee | undefined; readOnly: boolean; m: ReturnType<typeof useEventMutations>; closeEditor: () => void }) {
  return (
    <>
          {ev && (
            <div className="flex flex-col gap-3 pt-4">
              {myInvite && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] text-muted-foreground">Going?</span>
                  {(["accepted", "tentative", "declined"] as Rsvp[]).map((r) => (
                    <Button
                      key={r}
                      variant={ev.rsvp === r ? "secondary" : "outline"}
                      size="sm"
                      disabled={m.rsvp.isPending}
                      onClick={() => m.rsvp.mutate({ id: ev.id, rsvp: r })}
                    >
                      {ev.rsvp === r && <Check />}
                      {RSVP_LABEL[r as string]}
                    </Button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {meetingLink(ev) && (
                  // Native shells never navigate away from the server: hand the link to the OS.
                  <Button size="sm" variant="outline" onClick={() => openExternalUrl(meetingLink(ev))}>
                    <Video /> Join
                  </Button>
                )}
                {ev.kind === "todo" && !readOnly && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={m.setDone.isPending}
                    onClick={() => m.setDone.mutate({ id: ev.id, done: !ev.done, date: ev.occurrence_date ?? undefined })}
                  >
                    <Check /> {ev.done ? "Mark not done" : "Mark done"}
                  </Button>
                )}
                {ev.thread_id && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/t/${ev.thread_id}`} onClick={() => closeEditor()}>
                      <Mail /> The email this came from
                    </Link>
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-muted-foreground" asChild>
                  <a href={eventIcsUrl(ev.id)} download>
                    <Download /> Download .ics
                  </a>
                </Button>
              </div>

              <p className="text-xs text-tertiary">
                {ev.calendar_name}
                {ev.created_at ? ` · added ${new Date(ev.created_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}` : ""}
                {ev.updated_at && ev.updated_at !== ev.created_at
                  ? ` · edited ${new Date(ev.updated_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`
                  : ""}
              </p>
            </div>
          )}
    </>
  );
}
