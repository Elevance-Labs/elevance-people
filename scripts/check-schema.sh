#!/usr/bin/env bash
# Checks that supabase/schema.sql describes the same database as
# supabase/migrations/ applied in order.
#
# Starts a throwaway local Postgres, stubs the bits of Supabase the schema
# touches (auth, storage, the API roles), builds one database from the
# migrations and one from schema.sql, and diffs their schema-only dumps.
#
# Needs the Postgres server binaries (initdb, pg_ctl, psql, pg_dump) on PATH,
# e.g. `brew install postgresql@16` and
# `export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH`.
set -euo pipefail

cd "$(dirname "$0")/.."

for bin in initdb pg_ctl psql pg_dump createdb; do
  command -v "$bin" >/dev/null || { echo "check-schema: '$bin' not found on PATH" >&2; exit 2; }
done

tmp=$(mktemp -d)
export PGHOST=127.0.0.1 PGPORT=${CHECK_SCHEMA_PORT:-54329} PGUSER=postgres
cleanup() {
  pg_ctl -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

initdb -D "$tmp/data" -U postgres -A trust >/dev/null
# TCP only: the socket path under a long temp dir can exceed the OS limit.
pg_ctl -D "$tmp/data" -l "$tmp/log" -w \
  -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null

psql() { command psql -X -q -v ON_ERROR_STOP=1 "$@"; }

psql -d postgres <<'SQL'
create role anon;
create role authenticated;
create role supabase_auth_admin;
create role service_role;
SQL

stubs=$(cat <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean,
                              file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),
                              bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable
  as $$ select string_to_array(name, '/') $$;
SQL
)

for db in from_migrations from_schema; do
  createdb "$db"
  psql -d "$db" -c "$stubs"
done

for f in supabase/migrations/*.sql; do
  psql -d from_migrations -f "$f"
done
psql -d from_schema -f supabase/schema.sql

pg_dump -s from_migrations > "$tmp/from_migrations.sql"
pg_dump -s from_schema > "$tmp/from_schema.sql"

if diff -u "$tmp/from_migrations.sql" "$tmp/from_schema.sql"; then
  echo "check-schema: schema.sql matches the migrations."
else
  echo "check-schema: schema.sql and the migrations disagree (diff above: - migrations, + schema.sql)." >&2
  exit 1
fi
