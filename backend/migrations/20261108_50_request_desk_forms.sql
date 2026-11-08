-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-11-08
--
-- Request forms: a public, tokenized form through which people without a
-- seat (a firm's company clients, an in-house team's business colleagues)
-- submit requests into an organization's request desk.
--
--   request_desk_forms              one row per form: its organization, the
--                                   notices it shows, which sender domains
--                                   may submit, how long submissions are kept,
--                                   and the SHA-256 digest of its link token
--   request_desk_requests.form_id   the form a 'form' submission came through
--
-- The link token is random, shown once to the owner or admin who creates or
-- rotates the form, and stored only as a digest: a database read never
-- yields a working link. Rotating a form replaces the digest, so the old
-- link stops matching; disabling it keeps the digest but refuses lookups.
--
-- The backend is the only client. RLS is on with no policies, anon and
-- authenticated get nothing, and service_role reads and writes the form rows
-- it manages. A public submission is inserted by
-- request_desk_submit_form_request, which reuses request_desk_create_request
-- for the per-organization reference. Expired submissions are deleted by
-- request_desk_delete_expired_form_submissions; both are security-definer
-- functions, so service_role still holds no DELETE on request_desk_requests.
--
-- Safe to re-run: create ... if not exists, add column if not exists,
-- create or replace for functions.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.request_desk_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  -- SHA-256 of the link token, as lower-case hex. Never the token itself.
  token_hash text not null
    constraint request_desk_forms_token_hash_check
      check (token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  title text not null
    constraint request_desk_forms_title_check
      check (char_length(btrim(title)) between 1 and 120),
  intro text not null default ''
    constraint request_desk_forms_intro_check
      check (char_length(intro) <= 2000),
  -- The notices the form shows. Each organization edits the wording; the
  -- backend fills in a default when a form is created.
  disclaimer text not null
    constraint request_desk_forms_disclaimer_check
      check (char_length(btrim(disclaimer)) between 1 and 2000),
  privacy_notice text not null
    constraint request_desk_forms_privacy_notice_check
      check (char_length(btrim(privacy_notice)) between 1 and 2000),
  -- The organization's own privacy policy, linked from the privacy notice.
  privacy_policy_url text
    constraint request_desk_forms_privacy_policy_url_check
      check (
        privacy_policy_url is null
        or (char_length(privacy_policy_url) <= 500 and privacy_policy_url ~ '^https?://')
      ),
  -- Lower-case domains whose addresses may submit. Empty: any address.
  allowed_sender_domains text[] not null default '{}'
    constraint request_desk_forms_allowed_sender_domains_check
      check (cardinality(allowed_sender_domains) <= 50),
  -- How long a submission that has not become a matter is kept.
  retention_days integer not null default 365
    constraint request_desk_forms_retention_days_check
      check (retention_days between 1 and 3650),
  token_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_desk_forms_token_hash_key unique (token_hash)
);

create index if not exists request_desk_forms_org
  on public.request_desk_forms (org_id, created_at desc);

alter table public.request_desk_requests
  add column if not exists form_id uuid references public.request_desk_forms(id) on delete set null;

create index if not exists request_desk_requests_form
  on public.request_desk_requests (form_id)
  where form_id is not null;

alter table public.request_desk_forms enable row level security;

revoke all on public.request_desk_forms from anon, authenticated;

-- Forms are created, read, edited, rotated and disabled by the backend. They
-- are never deleted on their own: the organization cascade removes them.
revoke all on public.request_desk_forms from service_role;
grant select, insert, update on public.request_desk_forms to service_role;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

-- A public submission through an enabled form: the request gets the
-- organization's next reference through request_desk_create_request, source
-- 'form', no creator, normal priority, and is linked to its form, all in one
-- transaction. A form that is disabled (or gone) by the time the insert runs
-- is refused with a check_violation, which the backend answers as not found.
create or replace function public.request_desk_submit_form_request(
  p_form_id uuid,
  p_title text,
  p_details text,
  p_requester_name text,
  p_requester_email text
)
returns public.request_desk_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.request_desk_forms;
  v_request public.request_desk_requests;
begin
  select * into v_form
    from public.request_desk_forms f
   where f.id = p_form_id and f.enabled;
  if not found then
    raise exception 'request desk: the form is not available'
      using errcode = 'check_violation';
  end if;

  v_request := public.request_desk_create_request(
    v_form.org_id, null, 'form', p_title, p_details, null, 'normal',
    p_requester_name, p_requester_email, null, null
  );

  update public.request_desk_requests
     set form_id = p_form_id
   where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

-- Delete form submissions that were never turned into a matter once they are
-- older than their form's retention period (365 days for a submission whose
-- form is gone). Converted submissions (project_id set) are kept. Comments
-- cascade. Oldest first, at most p_limit rows per call, so a sweep stays
-- short and a backlog drains over several sweeps. Returns how many it deleted.
create or replace function public.request_desk_delete_expired_form_submissions(
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with expired as (
    select r.id
      from public.request_desk_requests r
      left join public.request_desk_forms f on f.id = r.form_id
     where r.source = 'form'
       and r.project_id is null
       and r.created_at < now() - make_interval(days => coalesce(f.retention_days, 365))
     order by r.created_at
     limit greatest(coalesce(p_limit, 500), 1)
  ),
  removed as (
    delete from public.request_desk_requests r
     using expired
     where r.id = expired.id
    returning r.id
  )
  select count(*) into v_deleted from removed;
  return v_deleted;
end;
$$;

revoke all on function public.request_desk_submit_form_request(
  uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.request_desk_delete_expired_form_submissions(integer)
  from public, anon, authenticated;

grant execute on function public.request_desk_submit_form_request(
  uuid, text, text, text, text
) to service_role;
grant execute on function public.request_desk_delete_expired_form_submissions(integer)
  to service_role;
