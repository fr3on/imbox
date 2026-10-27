import { Bell, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Row } from "./fields";
import type { Form } from "./form";
import { UNITS, splitReminder, type Unit } from "./reminders";

export function RemindersRow({ form, setForm, readOnly }: { form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; readOnly: boolean }) {
  return (
    <Row label="Reminders" icon={<Bell />}>
            <div className="flex flex-col gap-1.5">
              {form.reminders.map((r, i) => {
                const { n, unit } = splitReminder(r.minutes);
                const write = (nn: number, uu: Unit) =>
                  setForm((f) => ({ ...f, reminders: f.reminders.map((x, j) => (j === i ? { minutes: Math.max(0, nn) * UNITS[uu] } : x)) }));
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      value={n}
                      disabled={readOnly}
                      onChange={(e) => write(Number(e.target.value) || 0, unit)}
                      aria-label="Reminder amount"
                      className="h-7 w-16 tnum"
                    />
                    <Select value={unit} disabled={readOnly} onValueChange={(v) => write(n, v as Unit)}>
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">minutes</SelectItem>
                        <SelectItem value="hours">hours</SelectItem>
                        <SelectItem value="days">days</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-[13px] text-muted-foreground">before</span>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove reminder"
                        className="text-muted-foreground"
                        onClick={() => setForm((f) => ({ ...f, reminders: f.reminders.filter((_, j) => j !== i) }))}
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                );
              })}
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="w-fit text-muted-foreground"
                  onClick={() => setForm((f) => ({ ...f, reminders: [...f.reminders, { minutes: 10 }] }))}
                >
                  <Plus /> Add a reminder
                </Button>
              )}
              {form.reminders.length === 0 && readOnly && <span className="text-[13px] text-tertiary">None</span>}
            </div>
          </Row>
  );
}
