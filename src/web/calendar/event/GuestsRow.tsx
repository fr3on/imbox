import { AddressInput } from "@/components/AddressInput";
import { RSVP_LABEL } from "./fields";
import type { Form } from "./form";

export function GuestsRow({ form, guestAddresses, setGuests, readOnly }: { form: Form; guestAddresses: { email: string; name: string }[]; setGuests: (next: { email: string; name: string }[]) => void; readOnly: boolean }) {
  return (
    <div className="border-b border-border py-1">
            <AddressInput label="Guests" value={guestAddresses} onChange={setGuests} placeholder={readOnly ? "" : "Invite people…"} />
            {form.guests.some((g) => g.rsvp && g.rsvp !== "needsAction") && (
              <ul className="flex flex-col gap-0.5 py-1 pl-[68px] text-xs text-muted-foreground">
                {form.guests
                  .filter((g) => g.rsvp && g.rsvp !== "needsAction")
                  .map((g) => (
                    <li key={g.email} className="flex items-center gap-1.5">
                      <span className="truncate">{g.name || g.email}</span>
                      <span className="text-tertiary">· {RSVP_LABEL[g.rsvp as string] ?? g.rsvp}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
  );
}
