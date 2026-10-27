import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAccount } from "../context/AccountContext";
import { WEBSITE_URL } from "../lib/site";

/**
 * The page for an address that leads nowhere. It stands outside the signed-in app, so it looks the same to everyone and a signed-out visitor sees it
 * instead of being sent to sign in. It asks search engines to leave it out of their results.
 */
export default function NotFound() {
  const { pathname } = useLocation();
  const { setupRequired, user } = useAccount();
  const wayIn = user ? "/" : setupRequired ? "/signup" : "/login";
  const wayInLabel = user ? "Open your inbox" : setupRequired ? "Set up imbox" : "Sign in";

  useEffect(() => {
    const before = document.title;
    document.title = "Page not found · imbox";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.append(meta);
    return () => {
      document.title = before;
      meta.remove();
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[460px] flex-col justify-center gap-3 px-6">
      <p className="caps">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">That page wandered off.</h1>
      <p className="text-muted-foreground">
        Nothing lives at <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{pathname}</code>. It may have moved, or the address may have a typo.
      </p>
      <div className="flex gap-2 pt-2">
        <Button asChild>
          <Link to={wayIn}>{wayInLabel}</Link>
        </Button>
        {WEBSITE_URL ? (
          <Button asChild variant="ghost">
            <a href={WEBSITE_URL}>Visit the website</a>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
