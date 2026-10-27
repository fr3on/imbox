-- A domain used to be set up through Cloudflare Email Routing, which delivered mail to a Cloudflare Worker. Mail now arrives over HTTP from the owner's own
-- mail server (POST /inbound/mail), and whether a domain works is read from whether mail has arrived, so the columns that described the Cloudflare setup go.
ALTER TABLE domains DROP COLUMN zone_id;
ALTER TABLE domains DROP COLUMN status;
ALTER TABLE domains DROP COLUMN routing;
ALTER TABLE domains DROP COLUMN sending;
ALTER TABLE domains DROP COLUMN error;
ALTER TABLE domains DROP COLUMN dns_json;
