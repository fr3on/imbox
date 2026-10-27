import type { ReactNode } from "react";
import { toast as sonner } from "sonner";

export type ToastKind = "info" | "success" | "error";
export interface ToastOptions {
  kind?: ToastKind;
  action?: { label: string; onClick: () => void };
  duration?: number;
}
export interface PushOptions extends ToastOptions {
  title: ReactNode;
  body?: ReactNode;
}

function fire({ title, body, kind, action, duration }: PushOptions): number {
  const opts = {
    description: body,
    duration: duration ?? (kind === "error" ? 7000 : 4000),
    action: action ? { label: action.label, onClick: action.onClick } : undefined,
  };
  const id = kind === "error" ? sonner.error(title as string, opts) : kind === "success" ? sonner.success(title as string, opts) : sonner(title as string, opts);
  return typeof id === "number" ? id : Number(String(id).replace(/\D/g, "")) || 0;
}

/** Sonner-backed toast API compatible with the v2 hook. */
export function useToast() {
  return {
    toast: (message: ReactNode, opts?: ToastOptions) => fire({ title: message, ...opts }),
    push: (opts: PushOptions) => fire(opts),
    dismiss: (id?: number) => sonner.dismiss(id),
  };
}
