-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-11-07
--
-- Plans, seats and trials for an organization (PLANS_ENABLED).
--
-- One row per organization records which plan it is on, the state of its
-- subscription, an optional seat-limit override and the trial window. The
-- plan catalog itself — names, prices, seat limits and token allowances —
-- lives in deployment configuration (PLANS_CATALOG_JSON), never in the
-- database and never in this repository; this table only names the plan a
-- workspace is on and the facts a provider gives back about its subscription.
--
--   org_subscriptions   one row per organization, created with the org
--
-- Entitlements are off unless the backend runs with PLANS_ENABLED set. Until
-- then every organization is unlimited, as before, and these rows are only
-- recorded. A row is created for every organization as it is created — team
-- organizations and the hidden personal organization alike — by a trigger, so
-- the backend never has to remember to. Deleting the organization takes its
-- subscription with it.
--
-- Seat checks run in security-definer functions so that counting the seats in
-- use and taking one happen together under a lock, which a read-then-insert in
-- the service layer cannot guarantee: two people accepting the last seat at
-- once would both pass. The effective seat limit (the plan's, or the row's
-- override) is computed by the backend, which holds the catalog, and passed
-- in; a null limit means no limit.
--
-- The backend is the only client. The table enables RLS with no policies, anon
-- and authenticated get nothing, and service_role gets only what the backend
-- does through PostgREST. The functions are revoked from the browser roles and
-- granted to service_role alone, so they are never reachable as PostgREST RPCs
-- by a signed-in user.
--
-- Safe to re-run: create ... if not exists, create or replace for functions,
-- drop-before-create for the trigger.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.org_subscriptions (
  -- One subscription per organization; it is the primary key, and it cascades
  -- with the organization.
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- The plan the organization is on, as a key into the deployment's plan
  -- catalog, or null when it is on no named plan (a bare trial, or a
  -- self-hosted deployment that runs no plans). Not a foreign key: the catalog
  -- is configuration, not a table.
  plan_key text
    constraint org_subscriptions_plan_key_check
    check (plan_key is null or char_length(plan_key) between 1 and 100),
  status text not null default 'trialing'
    constraint org_subscriptions_status_check
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'none')),
  -- An override that takes the place of the plan's own seat limit for this one
  -- organization; null to use the plan's. A limit of 0 would admit nobody, so
  -- it must be positive when set.
  seat_limit integer
    constraint org_subscriptions_seat_limit_check
    check (seat_limit is null or seat_limit >= 1),
  -- When the trial ends. Enforcement compares it with now() only while the
  -- status is 'trialing'; null is an open trial that does not expire on its
  -- own.
  trial_ends_at timestamptz,
  -- The end of the current paid period, as a provider reports it; null when
  -- there is none.
  current_period_end timestamptz,
  -- Opaque references into the billing provider, set only once billing is
  -- wired. They are not secrets, but they name the customer, so they are never
  -- returned to a browser (see the plans module).
  provider_customer_ref text
    constraint org_subscriptions_provider_customer_ref_check
    check (provider_customer_ref is null or char_length(provider_customer_ref) <= 255),
  provider_subscription_ref text
    constraint org_subscriptions_provider_subscription_ref_check
    check (provider_subscription_ref is null or char_length(provider_subscription_ref) <= 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_subscriptions enable row level security;
revoke all on public.org_subscriptions from public, anon, authenticated;
grant select, insert, update on public.org_subscriptions to service_role;

-- ---------------------------------------------------------------------------
-- A trial row for every organization, created with it
-- ---------------------------------------------------------------------------

-- The default trial window. The per-plan trial length in the catalog applies
-- when a plan is assigned to an organization; a freshly created organization
-- that is on no named plan yet gets this neutral window so its trial has an
-- end.
create or replace function public.org_subscription_default_trial_days()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 14
$$;

create or replace function public.create_org_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_subscriptions (org_id, status, trial_ends_at)
  values (
    new.id,
    'trialing',
    now() + make_interval(days => public.org_subscription_default_trial_days())
  )
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_org_trial_subscription on public.organizations;
create trigger create_org_trial_subscription
  after insert on public.organizations
  for each row
  execute function public.create_org_trial_subscription();

-- Keep updated_at honest on any change.
create or replace function public.touch_org_subscription()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_org_subscription on public.org_subscriptions;
create trigger touch_org_subscription
  before update on public.org_subscriptions
  for each row
  execute function public.touch_org_subscription();

-- ---------------------------------------------------------------------------
-- Seat counting and taking a seat
-- ---------------------------------------------------------------------------

-- The seats an organization has in use: its members, and the invitations still
-- open (pending and not expired), which hold a seat until they are accepted,
-- declined or expire. The backend compares the total with the effective seat
-- limit before sending an invitation, and shows the member count as "seats
-- used".
create or replace function public.org_seat_state(p_org_id uuid)
returns table (member_count integer, pending_invite_count integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (
      select count(*)::integer
      from public.org_members m
      where m.org_id = p_org_id
    ),
    (
      select count(*)::integer
      from public.org_invitations i
      where i.org_id = p_org_id
        and i.status = 'pending'
        and i.expires_at > now()
    );
$$;

-- Take a seat for a member joining an organization, if one is free, under a
-- lock on the organization so that two acceptances cannot both take the last
-- seat. Returns:
--   'ok'                  the member row exists now (inserted, or already there)
--   'seat_limit_reached'  the limit is full and this user is not a member
-- p_seat_limit is the effective limit the backend computed from the plan and
-- the override; null means no limit. The role must already be validated by the
-- caller; the org_members check constraint is the backstop.
create or replace function public.org_claim_seat(
  p_org_id uuid,
  p_user_id uuid,
  p_role text,
  p_seat_limit integer
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  seats integer;
begin
  -- Serialize seat decisions for this organization on its own row, the same
  -- row the last-owner guard locks, so concurrent joins queue here.
  perform 1 from public.organizations where id = p_org_id for update;

  -- Already a member: no seat is taken, whatever the limit. The caller raises
  -- the role separately; this function only admits a new member.
  if exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id
  ) then
    return 'ok';
  end if;

  if p_seat_limit is not null then
    select count(*)::integer into seats
    from public.org_members
    where org_id = p_org_id;
    if seats >= p_seat_limit then
      return 'seat_limit_reached';
    end if;
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (p_org_id, p_user_id, p_role)
  on conflict (org_id, user_id) do nothing;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- This month's AI usage for an organization, aggregated for the plan page
-- ---------------------------------------------------------------------------

-- Tokens and calls in the current calendar month (UTC), grouped by model,
-- provider and key source, for one organization. Aggregated in the database so
-- a month of raw ledger rows never leaves it. The month is chosen the same way
-- usage_deployment_key_tokens chooses it.
create or replace function public.org_usage_month_summary(
  p_org_id uuid,
  p_month timestamptz default now()
)
returns table (
  model text,
  provider text,
  key_source text,
  input_tokens bigint,
  output_tokens bigint,
  cached_tokens bigint,
  calls bigint,
  estimated boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      date_trunc('month', p_month at time zone 'UTC') at time zone 'UTC' as starts_at,
      (date_trunc('month', p_month at time zone 'UTC') + interval '1 month') at time zone 'UTC' as ends_at
  )
  select
    e.model,
    e.provider,
    e.key_source,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.cached_tokens), 0)::bigint,
    count(*)::bigint,
    bool_or(e.tokens_estimated)
  from public.usage_events e, bounds b
  where e.org_id = p_org_id
    and e.created_at >= b.starts_at
    and e.created_at < b.ends_at
  group by e.model, e.provider, e.key_source
  order by e.model, e.provider, e.key_source;
$$;

-- ---------------------------------------------------------------------------
-- Function grants: the backend's role alone
-- ---------------------------------------------------------------------------

revoke all on function public.org_subscription_default_trial_days()
  from public, anon, authenticated;
revoke all on function public.create_org_trial_subscription()
  from public, anon, authenticated;
revoke all on function public.touch_org_subscription()
  from public, anon, authenticated;
revoke all on function public.org_seat_state(uuid)
  from public, anon, authenticated;
revoke all on function public.org_claim_seat(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.org_usage_month_summary(uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.org_seat_state(uuid) to service_role;
grant execute on function public.org_claim_seat(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.org_usage_month_summary(uuid, timestamptz)
  to service_role;
