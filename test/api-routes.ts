import { app } from "../src/api/index";

/**
 * Every HTTP route the app serves, as [method, path template], read from the app itself, so a route that is added is covered by the sweeps without
 * anyone listing it here. Middleware (the `*` paths) is left out.
 */
export const ROUTES: [string, string][] = [
  ...new Set(app.routes.filter((r) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method) && !r.path.includes("*")).map((r) => `${r.method} ${r.path}`)),
].map((r) => r.split(" ", 2) as [string, string]);

/** Open to anyone who is not signed in. */
export const PUBLIC: string[] = ["GET /api/version", "GET /api/me"];

/** A template with every parameter replaced by a throwaway value. */
export const anyPath = (template: string): string => template.replace(/:file\{[^}]*\}/, "x.ics").replace(/:[A-Za-z]+/g, "x");
