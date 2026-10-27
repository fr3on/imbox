import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Calendar } from "@shared/types";
import { useCalendarSourceMutations } from "../../api";
import { FormShell } from "../../settings/parts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ImportDialog({ open, calendars, onClose }: { open: boolean; calendars: Calendar[]; onClose: () => void }) {
  const { importIcs, create } = useCalendarSourceMutations();
  const [dest, setDest] = useState("");
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const writable = useMemo(() => calendars.filter((c) => c.writable), [calendars]);

  // Keep the destination pointing at a calendar that still exists; default to the default one.
  useEffect(() => {
    setDest((d) => {
      if (writable.some((c) => c.id === d)) return d;
      return writable.length === 0 ? "" : (writable.find((c) => c.is_default) ?? writable[0]).id;
    });
  }, [writable]);

  const pick = async (f: File | null) => {
    if (!f) return;
    setImporting(true);
    try {
      const text = await f.text();
      importIcs.mutate(
        { ics: text, calendar_id: dest || undefined },
        {
          onSuccess: (r) => { toast(`Imported ${r.imported} event${r.imported === 1 ? "" : "s"}`); onClose(); },
          onError: (e) => toast.error((e as Error).message),
          onSettled: () => setImporting(false),
        },
      );
    } catch {
      setImporting(false);
      toast.error("That file couldn't be read.");
    }
    if (file.current) file.current.value = "";
  };

  return (
    <FormShell
      open={open}
      onClose={onClose}
      title="Import an .ics file"
      description="Its events are added to the calendar you pick."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!dest || importing || importIcs.isPending} onClick={() => file.current?.click()}>
            <Upload /> {importing || importIcs.isPending ? "Importing…" : "Choose a file"}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Select value={dest} onValueChange={setDest} disabled={writable.length === 0}>
          <SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue placeholder="No calendar to import into" /></SelectTrigger>
          <SelectContent>
            {writable.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { name: "New calendar", color: "#111111" },
              { onSuccess: (c) => { setDest(c.id); toast("Calendar added"); }, onError: (e) => toast.error((e as Error).message) },
            )
          }
        >
          <Plus /> New calendar
        </Button>
      </div>
      <input ref={file} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
    </FormShell>
  );
}
