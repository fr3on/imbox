import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { handleStatus, handleSignup } from "./signup";
import { handleLogin, handleLogout } from "./login";
import { handleTwoFactorLogin } from "./twofactor";
import { handlePasskeyLoginOptions, handlePasskeyLoginVerify } from "./passkey";
import { handleGoogleStart, handleGoogleHandoff, handleGoogleCallback } from "./google";
import { handleMicrosoftStart, handleMicrosoftHandoff, handleMicrosoftCallback } from "./microsoft";

export {
  MAX_PASSWORD_LENGTH,
  MAX_LOGIN_ATTEMPTS,
  LOGIN_LOCKOUT_MS,
  LOGIN_WINDOW_MS,
  clientIp,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  appOrigin,
  HANDOFF_PREFIX,
  CAL_PREFIX,
  CAL_ONLY_PREFIX,
  scopeModeForState,
  statePrefixFor,
} from "./shared";

const auth = new Hono<AppEnv>();

auth.get("/status", handleStatus);
auth.post("/signup", handleSignup);
auth.post("/setup", handleSignup);
auth.post("/login", handleLogin);
auth.post("/login/2fa", handleTwoFactorLogin);
auth.post("/passkey/login-options", handlePasskeyLoginOptions);
auth.post("/passkey/login-verify", handlePasskeyLoginVerify);
auth.post("/logout", handleLogout);

auth.get("/google/start", handleGoogleStart);
auth.get("/google/handoff", handleGoogleHandoff);
auth.get("/google/callback", handleGoogleCallback);

auth.get("/microsoft/start", handleMicrosoftStart);
auth.get("/microsoft/handoff", handleMicrosoftHandoff);
auth.get("/microsoft/callback", handleMicrosoftCallback);

export default auth;
