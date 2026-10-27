import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS, STEP_INDEX, type Step } from "./steps";

export function StepperHeader({
  currentStep,
  onStepClick,
}: {
  currentStep: Step;
  onStepClick?: (step: Step) => void;
}) {
  const currentIndex = STEP_INDEX[currentStep];

  return (
    <nav aria-label="Setup progress" className="mb-8">
      <ol className="flex items-center justify-between">
        {STEPS.map((s, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isClickable = onStepClick && isCompleted && s.id !== "setup";

          const pill = (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  isCompleted && "bg-foreground text-background",
                  isCurrent && "border-2 border-foreground bg-background text-foreground",
                  !isCompleted && !isCurrent && "border border-border text-muted-foreground"
                )}
              >
                {isCompleted ? <Check className="size-3.5 stroke-[3]" /> : idx + 1}
              </span>
              <span
                className={cn(
                  "text-xs font-medium tracking-tight",
                  isCurrent ? "text-foreground font-semibold" : "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </div>
          );

          return (
            <li key={s.id} className="flex flex-1 items-center last:flex-none">
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick(s.id)}
                  className="cursor-pointer hover:opacity-85 transition-opacity text-left"
                  title={`Go back to ${s.label}`}
                >
                  {pill}
                </button>
              ) : (
                pill
              )}
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 sm:mx-3 h-[1px] flex-1 transition-colors",
                    idx < currentIndex ? "bg-foreground" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
