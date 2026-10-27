import { Hono } from "hono";
import type { AppEnv } from "../../env";
import lists from "./lists";
import search from "./search";
import thread, { applyAction, applyActionMany, loadThreadDetail, type ActionBody } from "./thread";
import messages from "./messages";
import files from "./files";

const mail = new Hono<AppEnv>();

mail.route("/", lists);
mail.route("/", search);
mail.route("/", thread);
mail.route("/", messages);
mail.route("/", files);

export { loadThreadDetail, applyAction, applyActionMany };
export type { ActionBody };
export { VISIBLE, PAGE, MAX_QUERY, MAX_SEARCH_TERMS, MAX_EXCLUDED_TERMS, capTerms, scope } from "./shared";
export default mail;
