import { useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import type { CalEvent } from "@shared/types";
import { BrandIcon } from "../../../components/BrandIcons";
import { fmtTime } from "../../../lib/format";

export function EventsTab({ events, q }: { events: CalEvent[]; q: string }) {
  const nav = useNavigate();

  if (events.length === 0) {
    return (
      <div className="text-center py-12 rounded-xl border border-dashed border-border/80">
        <BrandIcon name="calendar" className="size-8 mx-auto text-muted-foreground/60 mb-2" />
        <div className="font-medium text-sm text-foreground">No calendar events matched “{q}”</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {events.map((e) => (
        <div
          key={e.id}
          onClick={() => nav("/calendar")}
          className="p-4 rounded-xl border border-border/80 bg-card hover:bg-muted/40 transition-all shadow-xs cursor-pointer"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="size-3.5 rounded-full shrink-0"
              style={{ backgroundColor: e.calendar_color || "#3b82f6" }}
            />
            <h3 className="font-semibold text-sm text-foreground truncate">{e.title}</h3>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>{e.all_day ? "All day" : fmtTime(e.starts_at)}</p>
            {e.location && (
              <p className="flex items-center gap-1 truncate">
                <MapPin className="size-3 shrink-0" /> {e.location}
              </p>
            )}
            {e.description && (
              <p className="line-clamp-2 text-[11px] text-muted-foreground/80 mt-1">
                {e.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
