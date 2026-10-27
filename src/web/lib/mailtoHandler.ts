// Telling the browser to open mailto: links in this app. Browser-only, so it is kept apart from the link parser.

/** The address a browser is told to send mailto: links to. `%s` is where it puts the link. */
export const mailtoHandlerUrl = () => `${location.origin}/compose?mailto=%s`;

/** Browsers that can be told to open email links in a web app (Chrome, Edge, Firefox; not Safari). */
type WithHandlers = { registerProtocolHandler?: (scheme: string, url: string) => void };
export const canRegisterMailto = () => typeof navigator !== "undefined" && typeof (navigator as WithHandlers).registerProtocolHandler === "function";

/** Asks the browser to open mailto: links here. It shows its own confirmation; nothing changes until the person agrees. */
export function registerMailtoHandler(): boolean {
  if (!canRegisterMailto()) return false;
  try {
    (navigator as WithHandlers).registerProtocolHandler?.("mailto", mailtoHandlerUrl());
    return true;
  } catch {
    return false;
  }
}
