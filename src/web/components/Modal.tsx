import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" } as const;

export function Modal({ open, onClose, title, subtitle, children, wide, footer, size, bare }: { open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean; size?: "sm" | "md" | "lg" | "xl"; footer?: ReactNode; bare?: boolean }) {
  const sz = SIZES[size ?? (wide ? "lg" : "md")];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(sz, bare && "p-0 gap-0")} showCloseButton={!bare}>
        {(title || subtitle) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : <DialogDescription className="sr-only">Dialog</DialogDescription>}
          </DialogHeader>
        )}
        {!title && <DialogTitle className="sr-only">Dialog</DialogTitle>}
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

