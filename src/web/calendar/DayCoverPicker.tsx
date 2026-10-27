import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCalendar } from "./CalendarContext";
import { useCalendarDayMutation, useDayCoverMutations, useDayCovers } from "../api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * The cover photo: a picture stuck on a day, chosen here — Week view is the one place you set
 * it, reused from a small library so the same photo can cover more than one day. Year view only
 * ever reflects whichever one is already set (see YearView.tsx), never opens this.
 */
export function DayCoverButton({ date, className }: { date: string; className?: string }) {
  const { dayInfo } = useCalendar();
  const info = dayInfo(date);
  const covers = useDayCovers();
  const { upload, remove } = useDayCoverMutations();
  const dayMutation = useCalendarDayMutation();
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setCover = (cover_id: string | null) => {
    dayMutation.mutate({ date, cover_id });
    setOpen(false);
  };

  const onFile = async (file: File) => {
    const cover = await upload.mutateAsync(file);
    setCover(cover.id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={info?.cover_url ? "Change cover photo" : "Add a cover photo"}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground hover:text-foreground",
            !info?.cover_url && "border border-dashed border-border",
            className,
          )}
        >
          {info?.cover_url ? (
            <img src={info.cover_url} alt="" className="h-full w-full object-cover" style={{ objectPosition: info.cover_position || "50% 50%" }} />
          ) : (
            <ImagePlus size={13} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" onClick={(e) => e.stopPropagation()} align="start">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary">Cover photo</span>
          {info?.cover_id && (
            <Button size="xs" variant="ghost" className="h-5 px-1 text-muted-foreground" onClick={() => setCover(null)}>
              <X /> Remove
            </Button>
          )}
        </div>
        {covers.data && covers.data.length > 0 && (
          <div className="mb-2 grid grid-cols-5 gap-1">
            {covers.data.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCover(c.id)}
                className={cn("group relative aspect-square overflow-hidden rounded-sm", info?.cover_id === c.id && "ring-2 ring-foreground")}
              >
                <img src={c.url} alt="" className="h-full w-full object-cover" />
                <span
                  className="absolute inset-0 hidden items-center justify-center bg-background/70 group-hover:flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove.mutate(c.id);
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" className="w-full" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
          {upload.isPending ? "Uploading…" : "Upload a photo"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
