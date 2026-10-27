-- Tell whoever is listening that a person's mail changed. Every insert, update or delete of a thread sends the owner's id on the `imbox_changes` channel; the
-- web server listens, and each open window is told through /api/events. PostgreSQL sends one notice per owner per transaction however many threads changed.
CREATE FUNCTION notify_thread_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner TEXT;
BEGIN
  SELECT user_id INTO owner FROM accounts WHERE id = CASE TG_OP WHEN 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  IF owner IS NOT NULL THEN
    PERFORM pg_notify('imbox_changes', owner);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER threads_notify AFTER INSERT OR UPDATE OR DELETE ON threads FOR EACH ROW EXECUTE FUNCTION notify_thread_change();
