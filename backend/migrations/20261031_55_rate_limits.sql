-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
-- Shared rate-limit counters. API replicas count the sign-in, MFA, email,
-- public and model-calling lanes here, so a limit holds across replicas and
-- restarts instead of per process. Each row is one fixed window for one key.
-- The API stores a SHA-256 digest of the key (a client address, a user id or
-- an already hashed email) behind a lane prefix, never the raw value. Only the
-- backend's service role reaches the counters, and only through the functions
-- below; the maintenance sweep deletes windows that have ended.

create table if not exists public.rate_limit_windows (
  key text primary key check (length(key) between 1 and 200),
  hits integer not null check (hits >= 0),
  reset_at timestamptz not null
);

create index if not exists rate_limit_windows_reset_at
  on public.rate_limit_windows(reset_at);

alter table public.rate_limit_windows enable row level security;
revoke all on public.rate_limit_windows
  from public, anon, authenticated, service_role;

-- Counts one request and returns the window's total and end. One statement
-- both counts and, once the stored window has ended, opens a new one:
-- INSERT ... ON CONFLICT DO UPDATE locks the row, so concurrent requests for
-- a key from any replica are serialized and exactly one of them starts each
-- new window.
create or replace function public.check_rate_limit(
  p_key text,
  p_window_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
  v_reset_at timestamptz;
begin
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_key';
  end if;
  if p_window_ms is null or p_window_ms < 1 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_window';
  end if;

  insert into public.rate_limit_windows as w (key, hits, reset_at)
  values (p_key, 1, now() + p_window_ms * interval '1 millisecond')
  on conflict (key) do update
    set hits = case when w.reset_at <= now() then 1 else w.hits + 1 end,
        reset_at = case
          when w.reset_at <= now()
            then now() + p_window_ms * interval '1 millisecond'
          else w.reset_at
        end
  returning w.hits, w.reset_at into v_hits, v_reset_at;

  return jsonb_build_object('hits', v_hits, 'reset_at', v_reset_at);
end;
$$;

-- Gives back one request of the current window (a lane that does not count
-- successful requests calls this once the response succeeds). A window that
-- has already ended is left alone.
create or replace function public.decrement_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rate_limit_windows
     set hits = hits - 1
   where key = p_key
     and hits > 0
     and reset_at > now();
$$;

create or replace function public.reset_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limit_windows where key = p_key;
$$;

-- Deletes up to p_limit ended windows and returns how many it deleted. Rows a
-- request is counting at that moment are skipped, not waited for.
create or replace function public.prune_rate_limit_windows(
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 100000 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_prune_limit';
  end if;

  with ended as (
    select w.key
      from public.rate_limit_windows w
     where w.reset_at <= now()
     order by w.reset_at
     limit p_limit
       for update skip locked
  )
  delete from public.rate_limit_windows w
   using ended
   where w.key = ended.key;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.check_rate_limit(text, integer)
  from public, anon, authenticated;
revoke all on function public.decrement_rate_limit(text)
  from public, anon, authenticated;
revoke all on function public.reset_rate_limit(text)
  from public, anon, authenticated;
revoke all on function public.prune_rate_limit_windows(integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer) to service_role;
grant execute on function public.decrement_rate_limit(text) to service_role;
grant execute on function public.reset_rate_limit(text) to service_role;
grant execute on function public.prune_rate_limit_windows(integer) to service_role;
