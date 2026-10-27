import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ToolButton({ label, kbd, onClick, children, active }: { label: string; kbd?: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("text-muted-foreground hover:text-foreground", active && "bg-muted text-foreground")}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
