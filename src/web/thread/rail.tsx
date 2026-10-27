import { BrandIcon } from "@/components/BrandIcons";
import * as React from "react";
import { Check, ChevronRight, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The small heading over each group of items in the More menu. */
export const MENU_GROUP = "px-1.5 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground/80";

export const bucketIcon = { imbox: <BrandIcon name="imbox" />, feed: <BrandIcon name="feed" />, paper_trail: <ScrollText /> } as const;

/** A vertical stack for the side rail: the same job ButtonGroup does in the bottom bar, without joining the buttons into one block. */
export function RailGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-1">{children}</div>;
}

/** One line of the opened rail: icon, label, and the shortcut or a chevron at the far end. */
export const RailRow = React.forwardRef<HTMLButtonElement, { icon: React.ReactNode; label: string; kbd?: string; checked?: boolean; chevron?: boolean; primary?: boolean; destructive?: boolean; disabled?: boolean; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ icon, label, kbd, checked, chevron, primary, destructive, disabled, active, className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
        primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted",
        active && !primary && "bg-muted",
        className,
      )}
      {...rest}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && <Check className="ml-auto size-4" />}
      {chevron && <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />}
      {kbd && <Kbd className={cn("ml-auto", primary && "bg-primary-foreground/20 text-primary-foreground")}>{kbd}</Kbd>}
    </button>
  ),
);
RailRow.displayName = "RailRow";

export const RailLabel = ({ children }: { children: React.ReactNode }) => <div className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground/80">{children}</div>;

export const RailSep = () => <div className="my-1 h-px bg-border" />;

export function Bar({ label, kbd, side, children }: { label: string; kbd?: string; side?: "top" | "right"; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {label} {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
