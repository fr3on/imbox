import * as React from "react";
import { Pencil, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import type { ThreadDetail, } from "@shared/types";
import type { Run } from "./types";

export function NoteBox({ t, noteOpen, setNoteOpen, noteDraft, setNoteDraft, noteRef, saveNote, run }: { t: ThreadDetail; noteOpen: boolean; setNoteOpen: (v: boolean) => void; noteDraft: string; setNoteDraft: (v: string) => void; noteRef: React.RefObject<HTMLTextAreaElement | null>; saveNote: () => void; run: Run }) {
  return (
    <>
      {/* Sticky note */}
      {(t.note || noteOpen) && (
        <div className={cn("relative mt-4 rounded-md bg-muted px-3 py-2.5", !noteOpen && "cursor-text")} onClick={() => !noteOpen && setNoteOpen(true)}>
          <div className="flex items-start gap-2">
            <Pin size={13} className="text-muted-foreground mt-1 shrink-0" />
            {noteOpen ? (
              <div className="flex-1 min-w-0">
                <Textarea
                  ref={noteRef}
                  className="bg-transparent focus-visible:bg-transparent border-0 focus-visible:border-transparent p-0 min-h-14 text-[13px] rounded-none"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="A private note, just for you."
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setNoteOpen(false); setNoteDraft(t.note); }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote();
                  }}
                />
                <div className="flex items-center gap-1 mt-1.5">
                  {t.note && (
                    <Button variant="ghost" size="xs" className="text-muted-foreground mr-auto" onClick={() => { run({ action: "note", note: "" }, "Note removed"); setNoteOpen(false); }}>
                      Remove note
                    </Button>
                  )}
                  <span className="flex-1" />
                  <Button variant="outline" size="xs" onClick={() => { setNoteOpen(false); setNoteDraft(t.note); }}>Cancel</Button>
                  <Button size="xs" onClick={saveNote}>Save <Kbd className="ml-1 bg-background/20 text-background">⌘↵</Kbd></Button>
                </div>
              </div>
            ) : (
              <div className="group flex items-start gap-2 flex-1 min-w-0">
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap flex-1 min-w-0">{t.note}</div>
                <Pencil size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 mt-1 shrink-0" />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
