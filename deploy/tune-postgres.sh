#!/usr/bin/env bash
# Tunes PostgreSQL for a 2 vCPU / 4 GB machine that also runs the app, adds the extensions Imbox can use (pg_trgm for fast search, pgvector for
# embeddings, pg_stat_statements for finding slow queries) and the search indexes. Safe to re-run. Run as root.
# Sizes assume ~4 GB of RAM; pass RAM_MB to scale (RAM_MB=8192 bash tune-postgres.sh).
set -euo pipefail
ram="${RAM_MB:-$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)}"
ver="$(ls /etc/postgresql | sort -n | tail -1)"
conf="/etc/postgresql/$ver/main/conf.d/imbox.conf"

apt-get install -y "postgresql-$ver-pgvector" >/dev/null

sb=$((ram / 4))            # shared_buffers: a quarter of RAM
ec=$((ram / 2))            # effective_cache_size: what the OS is likely to cache for us
cat > "$conf" <<CONF
# Written by deploy/tune-postgres.sh for ${ram} MB of RAM
max_connections = 50                     # the app's pool is 10; leave room for psql and backups
shared_buffers = ${sb}MB
effective_cache_size = ${ec}MB
work_mem = 16MB
maintenance_work_mem = 256MB
random_page_cost = 1.1                   # SSD
effective_io_concurrency = 200
checkpoint_completion_target = 0.9
wal_compression = on
min_wal_size = 512MB
max_wal_size = 2GB
jit = off                                # JIT slows short OLTP queries
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
log_min_duration_statement = 500         # log queries slower than 0.5 s
log_lock_waits = on
CONF
chown postgres:postgres "$conf"

systemctl restart postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 imbox <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- Search runs ILIKE '%term%' over these columns; trigram indexes let Postgres avoid scanning every row.
CREATE INDEX IF NOT EXISTS idx_threads_subject_trgm      ON threads  USING gin (subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_snippet_trgm      ON threads  USING gin (snippet gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_participants_trgm ON threads  USING gin (participants_json gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_body_trgm        ON messages USING gin (text_body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_subject_trgm     ON messages USING gin (subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm       ON contacts USING gin (email gin_trgm_ops);
ANALYZE;
SQL
echo "PostgreSQL tuned for ${ram} MB."
