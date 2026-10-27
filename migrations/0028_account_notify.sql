-- Tell whoever is listening that something about a person's mailboxes changed that a window shows: one was added or removed, its sync state or error changed,
-- it was renamed or restyled, or its scopes changed. The owner's id goes out on the `imbox_accounts` channel (see 0027 for the mail itself). Stamping
-- `last_synced_at`, refreshing tokens and the like do not count: they happen every few minutes and nothing on screen changes with them.
CREATE FUNCTION notify_account_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('imbox_accounts', OLD.user_id);
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('imbox_accounts', NEW.user_id);
  ELSIF ROW(OLD.sync_status, OLD.sync_error, OLD.initial_sync_done, OLD.display_name, OLD.signature, OLD.cover_art, OLD.avatar_url, OLD.scopes, OLD.provider, OLD.email)
        IS DISTINCT FROM ROW(NEW.sync_status, NEW.sync_error, NEW.initial_sync_done, NEW.display_name, NEW.signature, NEW.cover_art, NEW.avatar_url, NEW.scopes, NEW.provider, NEW.email) THEN
    PERFORM pg_notify('imbox_accounts', NEW.user_id);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER accounts_notify AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION notify_account_change();
