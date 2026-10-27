import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AccountProvider, useAccount } from "./context/AccountContext";
import { ComposeProvider } from "./context/ComposeContext";
import { Toaster } from "@/components/ui/toaster-shim";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { whenIdle } from "./lib/lazy";
import { WEBSITE_URL } from "./lib/site";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

/**
 * The two apps are two chunks. A phone never downloads the desktop shell, sidebar, command palette
 * or a single desktop page, and a laptop never downloads the mobile ones. What is left in the entry
 * chunk is React, the router, the query client, the providers and the two sign-in pages — which is
 * everything a visitor who is not signed in will ever need.
 */
const loadDesktop = () => import("./DesktopApp");
const loadMobile = () => import("./MobileApp");
const DesktopApp = lazy(loadDesktop);
const MobileApp = lazy(loadMobile);

/** Painted in the theme's own background, so dark mode never flashes white while a chunk arrives. */
const Blank = () => <div className="min-h-dvh bg-background" />;

/**
 * At / a visitor who is not signed in goes straight to sign-in (or to sign-up on a server with no owner yet); the front page, the features tour and
 * the rest of the public pages live on the project's website, not here. Signed in, or on any other address, it is the app (which sends a
 * signed-out visitor on to /login).
 */
function Front({ Tree }: { Tree: React.ComponentType }) {
  const { user, loading, setupRequired } = useAccount();
  const { pathname } = useLocation();
  if (pathname === "/") {
    if (loading) return <Blank />;
    if (!user) return <Navigate to={setupRequired ? "/signup" : "/login"} replace />;
  }
  return (
    <Suspense fallback={<Blank />}>
      <Tree />
    </Suspense>
  );
}

/** An address the front site (or the privacy page or the docs) used to answer. It now lives on the website when one is configured, and is not found otherwise. */
function ToWebsite() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (WEBSITE_URL) window.location.replace(WEBSITE_URL + pathname);
  }, [pathname]);
  return WEBSITE_URL ? <Blank /> : <Navigate to="/" replace />;
}

export default function App() {
  const mobile = useIsMobile();
  // Fetch the app chunk while the sign-in page is on screen, so signing in lands on a warm cache.
  useEffect(() => {
    whenIdle(() => void (mobile ? loadMobile() : loadDesktop()).catch(() => {}));
  }, [mobile]);
  const Tree = mobile ? MobileApp : DesktopApp;
  return (
    <TooltipProvider delayDuration={300}>
      <Toaster />
      <AccountProvider>
        <ComposeProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/setup" element={<Navigate to="/signup" replace />} />
            {["/features", "/apps", "/brand", "/letter", "/privacy"].map((path) => (
              <Route key={path} path={path} element={<ToWebsite />} />
            ))}
            <Route path="/docs/*" element={<ToWebsite />} />
            <Route path="/*" element={<Front Tree={Tree} />} />
          </Routes>
        </ComposeProvider>
      </AccountProvider>
    </TooltipProvider>
  );
}
