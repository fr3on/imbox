import { Toaster as Sonner } from "sonner";
import { CircleAlert, CircleCheck, Info, Loader2 } from "lucide-react";

/**
 * Every confirmation and error in the app, in one place and one look.
 *
 * Top and centre, just under the header and the tabs, so it is where the eye already is and clear of the assistant box. In the app's own black
 * and white: a confirmation is a dark card that goes by itself, an error is the same card turned inside out (light, outlined) so it reads as
 * different. Theme follows the .dark class on <html>, which swaps the two.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={{ top: 118 }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", left: 16, right: 16 }}
      closeButton={false}
      duration={3500}
      visibleToasts={3}
      gap={8}
      style={
        {
          "--width": "420px",
          "--normal-bg": "var(--foreground)",
          "--normal-text": "var(--background)",
          "--normal-border": "transparent",
        } as React.CSSProperties
      }
      icons={{
        success: <CircleCheck className="size-[18px]" />,
        error: <CircleAlert className="size-[18px]" />,
        warning: <CircleAlert className="size-[18px]" />,
        info: <Info className="size-[18px]" />,
        loading: <Loader2 className="size-[18px] animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!shadow-[0_10px_30px_-12px_rgba(0,0,0,.45)] !rounded-2xl !pl-3.5 !pr-3 !py-2.5 !gap-2.5 !text-[13px] !font-medium !w-fit !min-w-[220px] !max-w-[min(440px,calc(100vw-24px))] !mx-auto",
          title: "!text-[13px] !font-medium !leading-5",
          description: "!text-background/70 !text-xs !font-normal",
          actionButton: "!ml-auto !bg-background !text-foreground !rounded-lg !h-7 !px-2.5 !text-xs !font-medium hover:!opacity-90",
          cancelButton: "!bg-transparent !text-background/70 !rounded-lg !h-7 !px-2.5 !text-xs",
          // An error is the inverse: light, with a dark outline.
          error: "[--normal-bg:var(--background)] [--normal-text:var(--foreground)] [--normal-border:var(--foreground)] [&_[data-description]]:!text-muted-foreground [&_[data-button]]:!bg-foreground [&_[data-button]]:!text-background",
          warning: "[--normal-bg:var(--background)] [--normal-text:var(--foreground)] [--normal-border:var(--foreground)] [&_[data-description]]:!text-muted-foreground [&_[data-button]]:!bg-foreground [&_[data-button]]:!text-background",
        },
      }}
    />
  );
}
