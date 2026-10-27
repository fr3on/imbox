import { Hono } from "hono";
import type { AppEnv } from "../../env";
import settings from "./settings";
import usage from "./usage";
import memory from "./memory";
import conversations from "./conversations";
import chat from "./chat";
import jev from "./jev";

const ai = new Hono<AppEnv>();

ai.route("/", settings);
ai.route("/", usage);
ai.route("/", memory);
ai.route("/", conversations);
ai.route("/", chat);
ai.route("/", jev);

export { userAccounts, deps, shimFor, threadForAi } from "./shared";

export default ai;
