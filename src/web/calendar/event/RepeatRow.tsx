import { Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateField, Row } from "./fields";
import type { Form, SetField } from "./form";
import { REPEAT_KINDS, repeatLabel, type RepeatEnd, type RepeatKind } from "./recurrence";

export function RepeatRow({ form, set, readOnly }: { form: Form; set: SetField; readOnly: boolean }) {
  return (
    <Row label="Repeat" icon={<Repeat />}>
            <div className="flex flex-col gap-1.5">
              <Select value={form.repeat} disabled={readOnly} onValueChange={(v) => set("repeat", v as RepeatKind)}>
                <SelectTrigger size="sm" className="w-full max-w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">{repeatLabel("never", form.startDate)}</SelectItem>
                  {REPEAT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {repeatLabel(k, form.startDate)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {form.repeat === "custom" && (
                <>
                  <Input
                    value={form.rruleText}
                    disabled={readOnly}
                    onChange={(e) => set("rruleText", e.target.value)}
                    placeholder="FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,TH"
                    aria-label="Recurrence rule"
                    className="h-7 font-mono text-[12px]"
                  />
                  <p className="text-xs text-tertiary">An iCalendar RRULE, without the ending — that's set below.</p>
                </>
              )}
              {form.repeat !== "never" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select value={form.repeatEnd} disabled={readOnly} onValueChange={(v) => set("repeatEnd", v as RepeatEnd)}>
                    <SelectTrigger size="sm" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Ends never</SelectItem>
                      <SelectItem value="until">Ends on…</SelectItem>
                      <SelectItem value="count">Ends after…</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.repeatEnd === "until" && <DateField value={form.until} disabled={readOnly} onChange={(d) => set("until", d)} />}
                  {form.repeatEnd === "count" && (
                    <span className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        value={form.count}
                        disabled={readOnly}
                        onChange={(e) => set("count", Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                        aria-label="Number of times"
                        className="h-7 w-16 tnum"
                      />
                      <span className="text-[13px] text-muted-foreground">times</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </Row>
  );
}
