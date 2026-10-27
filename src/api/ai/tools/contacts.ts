import { type DecisionScope, applyBundleFlag, applyScreenDecision } from "../../routes/screener";
import { loadSuggestions } from "../contactreview";
import { type ContactRow, inClause, ownedRow, toContact } from "../../db";
import { type Handler, resolveContact } from "./context";

export const screen_sender: Handler = async ({ ctx, input, db, ok, fail }) => {
  const contact = await ownedRow<ContactRow>(db, "contacts", String(input.contact_id ?? ""), ctx.user.id);
  if (!contact) return fail("Contact not found");
  const decision = String(input.decision);
  if (!["imbox", "feed", "paper_trail", "screened_out"].includes(decision)) return fail("Bad decision");
  await applyScreenDecision(db, contact.account_id, contact, decision as any);
  return ok({ ok: true, contact: toContact({ ...contact, screen_status: decision as any }) }, `${decision === "screened_out" ? "Screened out" : "Let in"} ${contact.name || contact.email}${decision !== "screened_out" ? ` → ${decision.replace("_", " ")}` : ""}`);
};

export const set_contact_destination: Handler = async ({ ctx, input, db, ok, fail }) => {
  const email = typeof input.email === "string" ? input.email.trim() : null;
  const contactId = typeof input.contact_id === "string" ? input.contact_id.trim() : null;
  const destination = String(input.destination || "");
  if (!["imbox", "feed", "paper_trail", "screened_out"].includes(destination)) {
    return fail("Destination must be one of: imbox, feed, paper_trail, screened_out");
  }
  const contact = await resolveContact(ctx, email, contactId);
  if (!contact) return fail("Contact not found");
  const scope: DecisionScope = input.scope === "account" ? "account" : "all";
  await applyScreenDecision(db, contact.account_id, contact, destination as any, scope);
  return ok(
    { ok: true, contact: { id: contact.id, email: contact.email, name: contact.name, destination, scope } },
    `Set destination for ${contact.name || contact.email} to ${destination.replace("_", " ")}`
  );
};

export const bundle_sender: Handler = async ({ ctx, input, db, ok, fail }) => {
  const email = typeof input.email === "string" ? input.email.trim() : null;
  const contactId = typeof input.contact_id === "string" ? input.contact_id.trim() : null;
  const bundled = input.bundled !== false;
  const contact = await resolveContact(ctx, email, contactId);
  if (!contact) return fail("Contact not found");
  const scope: DecisionScope = input.scope === "account" ? "account" : "all";
  await applyBundleFlag(db, contact.account_id, contact, bundled, scope);
  return ok(
    { ok: true, contact: { id: contact.id, email: contact.email, name: contact.name, bundled, scope } },
    `${bundled ? "Bundled" : "Unbundled"} senders from ${contact.name || contact.email}`
  );
};

export const list_noisy_or_misfiled_senders: Handler = async ({ ctx, input, db, sc, ok }) => {
  const kind = input.kind === "noisy" || input.kind === "misfiled" ? input.kind : "all";
  const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));

  const misfiled: unknown[] = [];
  let noisy: unknown[] = [];

  if (kind === "all" || kind === "misfiled") {
    const suggestions = (await loadSuggestions(db, ctx.user.id)).slice(0, limit);
    // The contact behind each address, the one heard from most recently when there are several: one lookup, not one for each suggestion.
    const addresses = [...new Set(suggestions.map((s) => s.email.toLowerCase()))];
    const contactOf = new Map<string, ContactRow>();
    if (addresses.length) {
      const found = await db
        .prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND LOWER(email) IN ${inClause(addresses).sql} ORDER BY last_seen_at DESC`)
        .bind(...sc.params, ...addresses)
        .all<ContactRow>();
      for (const c of found.results) if (!contactOf.has(c.email.toLowerCase())) contactOf.set(c.email.toLowerCase(), c);
    }
    for (const s of suggestions) {
      const contact = contactOf.get(s.email.toLowerCase());
      misfiled.push({
        email: s.email,
        name: contact?.name || "",
        current_destination: contact?.screen_status || "imbox",
        suggested_destination: s.suggest,
        reason: s.reason,
        message_count: contact?.message_count ?? 0,
        contact_id: contact?.id ?? null,
      });
    }
  }

  if (kind === "all" || kind === "noisy") {
    const rows = await db
      .prepare(
        `SELECT id, email, name, message_count, bundled, last_seen_at FROM contacts WHERE account_id IN ${sc.sql} AND screen_status = 'imbox' AND message_count >= 3 ORDER BY message_count DESC LIMIT ?`
      )
      .bind(...sc.params, limit)
      .all<ContactRow>();
    noisy = rows.results.map((r) => ({
      contact_id: r.id,
      email: r.email,
      name: r.name,
      message_count: r.message_count,
      bundled: !!r.bundled,
      last_seen: new Date(r.last_seen_at).toISOString(),
    }));
  }

  const parts: string[] = [];
  if (kind === "all" || kind === "misfiled") parts.push(`${misfiled.length} misfiled`);
  if (kind === "all" || kind === "noisy") parts.push(`${noisy.length} noisy`);
  const summaryMsg = `Found ${parts.join(" and ")} sender${misfiled.length + noisy.length === 1 ? "" : "s"}`;

  return ok({ kind, misfiled, noisy }, summaryMsg);
};
