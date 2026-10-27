import { AlertTriangle } from "lucide-react";

export const selectClass = "h-8 rounded-md bg-input px-2.5 text-sm outline-none focus:bg-background focus:ring-1 focus:ring-ring";

export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function Block({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-start justify-between gap-4 mb-3 px-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-[13px] text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Box({ children }: { children: React.ReactNode }) {
  return <div className="mx-2 rounded-lg border border-border overflow-hidden">{children}</div>;
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
