import { useEffect } from "react";
import { safeNext } from "../lib/safeNext";
import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useMe } from "../api";
import { useAccount } from "../context/AccountContext";
import { TypoLogo, Wordmark } from "../components/Logo";
import { isMac } from "../lib/native";
import { isDefaultBrand } from "@shared/brand";
import { cn } from "@/lib/utils";

/** The product's own name, which has its own logo; any other name is a renamed install. */

/** The name is safe to draw once the server (or the last visit) has said what it is, or once the server has answered at all and the default is all there is. */
function useBrandShown(): boolean {
  const { brandReady } = useAccount();
  const me = useMe();
  return brandReady || me.isFetched;
}

/** Sign-in and first-run setup: the name and one line, then the form, in one centred column. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  allowAuthenticated = false,
  maxWidth = "max-w-[380px]",
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  allowAuthenticated?: boolean;
  maxWidth?: string;
}) {
  const me = useMe();
  const [sp] = useSearchParams();
  const { appName } = useAccount();
  const brandShown = useBrandShown();

  useEffect(() => {
    if (title) document.title = `${title} · ${appName}`;
  }, [title, appName]);

  if (!allowAuthenticated && me.data?.user) return <Navigate to={safeNext(sp.get("next"))} replace />;
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* In the Mac app the window has no title bar: this strip clears the traffic lights and drags the window.
          On iPhone the same strip just clears the status bar. */}
      <div data-tauri-drag-region={isMac || undefined} className={cn("shrink-0 pt-safe", isMac ? "min-h-12" : "min-h-6")} />
      <div className="flex flex-1 items-start justify-center px-6 pb-10 pt-10 sm:items-center sm:pt-0">
        <div className={cn("w-full", maxWidth)}>
          <header className="mb-8 text-center">
            {isDefaultBrand(appName) ? <TypoLogo size={44} className={cn("mx-auto", !brandShown && "invisible")} /> : <Wordmark size={44} className={cn("mx-auto text-base", !brandShown && "invisible")} />}
            <p className="mt-2 text-sm text-muted-foreground">A calmer inbox, on infrastructure you control.</p>
          </header>
          {title ? <h1 className="text-center text-[26px] font-semibold leading-8 tracking-[-0.02em]">{title}</h1> : null}
          {subtitle ? <p className="mt-2 text-center text-sm text-muted-foreground">{subtitle}</p> : null}
          <div className={cn(title ? "mt-8" : "")}>{children}</div>
          {footer ? <div className="mt-8 text-xs leading-5 text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
      <p className="px-6 pb-6 text-center text-xs text-muted-foreground">Private mail, on your own server.</p>
    </div>
  );
}
