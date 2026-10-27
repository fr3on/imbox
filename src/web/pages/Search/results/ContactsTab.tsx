import { Link } from "react-router-dom";
import type { MergedContact } from "@shared/types";
import { BrandIcon } from "../../../components/BrandIcons";
import { Avatar } from "../../../components/Avatar";

export function ContactsTab({ contacts, q }: { contacts: MergedContact[]; q: string }) {
  if (contacts.length === 0) {
    return (
      <div className="text-center py-12 rounded-xl border border-dashed border-border/80">
        <BrandIcon name="sender" className="size-8 mx-auto text-muted-foreground/60 mb-2" />
        <div className="font-medium text-sm text-foreground">No contacts matched “{q}”</div>
        <p className="text-xs text-muted-foreground mt-1">Try searching by email or full name.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {contacts.map((c) => (
        <Link
          key={c.id}
          to={`/contacts/${c.id}`}
          className="p-4 rounded-xl border border-border/80 bg-card hover:bg-muted/40 hover:border-foreground/30 transition-all shadow-xs flex flex-col justify-between group"
        >
          <div className="flex items-start gap-3 mb-3">
            <Avatar email={c.email} name={c.name} src={c.avatar_url} size={40} />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-foreground truncate group-hover:underline">
                {c.name || c.email}
              </h3>
              {c.name && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
              {c.notes && (
                <p className="text-[11px] text-muted-foreground/80 line-clamp-2 mt-1">{c.notes}</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/60 text-[11px] text-muted-foreground">
            <span>{c.message_count ? `${c.message_count} messages` : "Contact"}</span>
            <span className="capitalize">{c.screen_status.replace("_", " ")}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
