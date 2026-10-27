#!/usr/bin/env bash
# Installed as /usr/local/bin/imbox-backup and run nightly. Dumps the database, keeps 14 days on disk, and copies to S3 when /etc/imbox/backup.env
# sets S3_BUCKET (the instance needs an IAM role or credentials allowing s3:PutObject on it).
# When backup.env also sets BACKUP_AGE_RECIPIENT (a public key from `age-keygen`), the dump is encrypted to it before it is written anywhere, so the
# server holds nothing that can open it. Without it the dump is written as it is, and the log line says so.
set -euo pipefail
# A dump holds everything: files are created readable by root only from the first byte, not chmod-ed after.
umask 077
[ -f /etc/imbox/backup.env ] && . /etc/imbox/backup.env
dir=/var/backups/imbox
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
recipient="${BACKUP_AGE_RECIPIENT:-}"
if [ -n "$recipient" ]; then
  command -v age >/dev/null || { echo "backup failed: BACKUP_AGE_RECIPIENT is set but age is not installed (apt-get install age)" >&2; exit 1; }
  file="$dir/imbox-$stamp.sql.gz.age"
else
  file="$dir/imbox-$stamp.sql.gz"
fi
# Written under another name and renamed when whole, so a dump that failed halfway is never mistaken for a backup.
trap 'rm -f "$file.part"' EXIT
if [ -n "$recipient" ]; then
  sudo -u postgres pg_dump --no-owner imbox | gzip -9 | age -r "$recipient" > "$file.part"
else
  sudo -u postgres pg_dump --no-owner imbox | gzip -9 > "$file.part"
fi
mv "$file.part" "$file"
chmod 600 "$file"
if [ -n "${S3_BUCKET:-}" ]; then aws s3 cp "$file" "s3://$S3_BUCKET/imbox/$(basename "$file")" --only-show-errors; fi
find "$dir" \( -name 'imbox-*.sql.gz' -o -name 'imbox-*.sql.gz.age' \) -mtime +14 -delete
if [ -n "$recipient" ]; then echo "backup ok (encrypted): $file"; else echo "backup ok (NOT encrypted, set BACKUP_AGE_RECIPIENT in /etc/imbox/backup.env): $file"; fi
