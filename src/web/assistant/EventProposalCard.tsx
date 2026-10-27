import { BrandIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import type { AiEventProposal } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Loader2, MapPin } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";

export function EventProposalCard({ p }: { p: AiEventProposal }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  const fmtRange = () => {
    if (p.all_day) {
      return `${p.start_date || "All day"} · All day`;
    }
    const d = p.start_date ? new Date(p.starts_at) : null;
    const dateStr = d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
    const startStr = new Date(p.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const endStr = new Date(p.ends_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${dateStr ? `${dateStr} · ` : ""}${startStr} – ${endStr}`;
  };

  const add = async () => {
    setState("adding");
    try {
      await api.post("/api/calendar/events", {
        calendar_id: p.calendar_id,
        title: p.title,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        all_day: p.all_day,
        start_date: p.start_date,
        end_date: p.end_date,
        location: p.location,
        description: p.description,
        attendees: p.attendees?.map((email) => ({ email })),
      });
      setState("added");
      toast("Event added to calendar");
      qc.invalidateQueries({ queryKey: ["calendar"] });
    } catch (e) {
      setState("idle");
      toast.error((e as Error).message || "Could not add event");
    }
  };

  const openInCalendar = () => {
    nav("/calendar", {
      state: {
        newEvent: {
          title: p.title,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
          all_day: p.all_day,
          start_date: p.start_date,
          end_date: p.end_date,
          location: p.location,
          description: p.description,
        },
      },
    });
  };

  if (state === "added") {
    return (
      <div className="my-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px] flex items-center gap-2 text-muted-foreground">
        <Check className="size-3.5 shrink-0 text-emerald-500" />
        <span className="truncate">
          Added to calendar · <span className="text-foreground/80 font-medium">{p.title}</span> ({fmtRange()})
        </span>
        <button
          type="button"
          onClick={openInCalendar}
          className="ml-auto shrink-0 underline underline-offset-2 hover:text-foreground text-[12px] cursor-pointer"
        >
          View
        </button>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg bg-muted/50 p-3 text-[13px] border border-border/40">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <BrandIcon name="calendar" className="size-3.5 text-primary" />
        <span className="truncate font-medium text-foreground/80">Proposed Event</span>
        <span className="text-xs text-muted-foreground ml-auto">{fmtRange()}</span>
      </div>
      <div className="font-semibold text-foreground text-[14px] mb-1">{p.title}</div>
      {p.location && (
        <div className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <MapPin className="size-3 shrink-0" /> {p.location}
        </div>
      )}
      {p.attendees && p.attendees.length > 0 && (
        <div className="mb-1 flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <BrandIcon name="sender" className="mt-0.5 size-3 shrink-0" /> {p.attendees.join(", ")}
        </div>
      )}
      {p.description && (
        <div className="text-[12px] text-muted-foreground/90 my-1.5 italic whitespace-pre-wrap">
          {p.description}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" onClick={add} disabled={state === "adding"}>
          {state === "adding" ? <Loader2 className="animate-spin size-3.5" /> : <CalendarPlus className="size-3.5" />}
          Add to calendar
        </Button>
        <Button size="sm" variant="ghost" onClick={openInCalendar}>
          Edit in calendar
        </Button>
      </div>
    </div>
  );
}
