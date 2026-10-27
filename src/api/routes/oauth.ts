import { Hono } from "hono";
import type { AppEnv } from "../env";
import { credentialsStatus, saveCreds, type OAuthProvider } from "../oauth";

const oauth = new Hono<AppEnv>();

const PROVIDERS: OAuthProvider[] = ["google", "microsoft"];

function isProvider(v: string): v is OAuthProvider {
  return (PROVIDERS as string[]).includes(v);
}

/** Where each provider's credentials come from, with the secret reduced to a hint. */
oauth.get("/", async (c) => {
  return c.json(await Promise.all(PROVIDERS.map((p) => credentialsStatus(c.env, p))));
});

oauth.put("/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "unknown_provider" }, 400);

  const b = await c.req
    .json<{ client_id?: string; client_secret?: string | null; override_env?: boolean }>()
    .catch(() => ({}) as never);
  if (b.client_id !== undefined && b.client_id !== null && (typeof b.client_id !== "string" || b.client_id.length > 500)) return c.json({ error: "invalid_client_id" }, 400);
  if (b.client_secret !== undefined && b.client_secret !== null && typeof b.client_secret !== "string") return c.json({ error: "invalid_secret" }, 400);
  if (typeof b.client_secret === "string" && (b.client_secret.length > 2000 || (b.client_secret.trim() && b.client_secret.trim().length < 8))) {
    return c.json({ error: "invalid_secret" }, 400);
  }

  // Taking over from an environment variable has to be deliberate, and it has to actually be possible —
  // otherwise a deployment configured by an environment variable could never rotate from here, which
  // is the whole reason this form exists. Saving credentials while an environment variable is set implies
  // the takeover unless the caller says otherwise.
  const status = await credentialsStatus(c.env, provider);
  const settingCreds = typeof b.client_id === "string" || typeof b.client_secret === "string";
  const patch = {
    ...b,
    override_env: typeof b.override_env === "boolean" ? b.override_env : status.env_available && settingCreds ? true : undefined,
  };

  if (patch.override_env === true) {
    // Against the stored row specifically: under an environment variable the resolved fields are always
    // populated, so checking those would let an override be set with nothing behind it — leaving a
    // row that breaks the moment the environment variable is removed.
    const willHaveSecret = (typeof b.client_secret === "string" && !!b.client_secret.trim()) || status.has_stored_secret;
    const willHaveId = (typeof b.client_id === "string" && !!b.client_id.trim()) || !!status.stored_client_id;
    if (!willHaveSecret || !willHaveId) {
      return c.json({ error: "incomplete_credentials", message: "Enter both a client ID and a secret before overriding the environment variable." }, 400);
    }
  }
  try {
    await saveCreds(c.env, provider, patch);
  } catch (e) {
    console.error("saving OAuth credentials failed", e);
    return c.json({ error: "save_failed", message: "The credentials could not be saved." }, 500);
  }
  return c.json(await credentialsStatus(c.env, provider));
});

export default oauth;
