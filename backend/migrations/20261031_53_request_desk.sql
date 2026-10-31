-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
--
-- Request desk: a queue of legal requests for an organization.
--
-- Requests from clients or business colleagues land here with a per-org
-- reference (REQ-1, REQ-2, ...), a status, a priority, an optional due date
-- and an owner, and can become a matter. Only team organizations have one:
-- the Personal workspace does not.
--
--   request_desk_requests   one row per request
--   request_desk_comments   its activity trail: comments, status changes and
--                           system events (assignment, matter created)
--   request_desk_counters   the last reference number used, per organization
--
-- The tables are named request_desk_* so they cannot collide with intake
-- tables in other forks of this codebase.
--
-- People and matters are referenced with ON DELETE SET NULL: deleting an
-- account keeps the organization's requests and their trail, and the
-- organization purge (purge_expired_organizations) deletes projects before the
-- organization row. The organization itself cascades.
--
-- The backend is the only client. Every table enables RLS with no policies,
-- anon and authenticated get nothing, and service_role gets only what the
-- backend does with PostgREST. Creating a request, changing its status,
-- assigning it and linking its matter run in security-definer functions, each
-- one transaction with its trail entry.
--
-- Safe to re-run: create ... if not exists, create or replace for functions,
-- drop-before-create for triggers.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.request_desk_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reference_number integer not null
    constraint request_desk_requests_reference_number_check
      check (reference_number > 0),
  reference text generated always as ('REQ-' || reference_number::text) stored,
  title text not null
    constraint request_desk_requests_title_check
      check (char_length(btrim(title)) between 1 and 200),
  details text not null default ''
    constraint request_desk_requests_details_check
      check (char_length(details) <= 20000),
  request_type text
    constraint request_desk_requests_request_type_check
      check (request_type is null or char_length(btrim(request_type)) between 1 and 80),
  status text not null default 'new'
    constraint request_desk_requests_status_check
      check (status in ('new', 'in_progress', 'waiting', 'closed', 'declined')),
  priority text not null default 'normal'
    constraint request_desk_requests_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent')),
  -- Sort key for priority, highest last.
  priority_rank smallint generated always as (
    case priority
      when 'low' then 0
      when 'normal' then 1
      when 'high' then 2
      else 3
    end
  ) stored,
  -- 'internal': logged in the app by a member. 'form': submitted through the
  -- organization's request form.
  source text not null default 'internal'
    constraint request_desk_requests_source_check
      check (source in ('internal', 'form')),
  requester_name text
    constraint request_desk_requests_requester_name_check
      check (requester_name is null or char_length(requester_name) <= 200),
  requester_email text
    constraint request_desk_requests_requester_email_check
      check (requester_email is null or char_length(requester_email) <= 320),
  assignee_user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  sla_due_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_desk_requests_reference_key unique (org_id, reference_number),
  -- Lets comments name their request and its organization together.
  constraint request_desk_requests_id_org_key unique (id, org_id),
  -- closed_at is set exactly while the request is closed or declined.
  constraint request_desk_requests_closed_check
    check ((status in ('closed', 'declined')) = (closed_at is not null))
);

create index if not exists request_desk_requests_org_status
  on public.request_desk_requests (org_id, status, created_at desc);
create index if not exists request_desk_requests_org_assignee
  on public.request_desk_requests (org_id, assignee_user_id)
  where assignee_user_id is not null;
create index if not exists request_desk_requests_org_due
  on public.request_desk_requests (org_id, sla_due_at)
  where sla_due_at is not null;
create index if not exists request_desk_requests_assignee
  on public.request_desk_requests (assignee_user_id)
  where assignee_user_id is not null;
create index if not exists request_desk_requests_created_by
  on public.request_desk_requests (created_by)
  where created_by is not null;
create index if not exists request_desk_requests_project
  on public.request_desk_requests (project_id)
  where project_id is not null;

create table if not exists public.request_desk_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'comment'
    constraint request_desk_comments_kind_check
      check (kind in ('comment', 'system', 'status_change')),
  -- A comment's text, or the optional note on a status change.
  body text not null default ''
    constraint request_desk_comments_body_check
      check (char_length(body) <= 10000),
  from_status text
    constraint request_desk_comments_from_status_check
      check (from_status is null or from_status in ('new', 'in_progress', 'waiting', 'closed', 'declined')),
  to_status text
    constraint request_desk_comments_to_status_check
      check (to_status is null or to_status in ('new', 'in_progress', 'waiting', 'closed', 'declined')),
  -- What a system entry records.
  event text
    constraint request_desk_comments_event_check
      check (event is null or event in ('assigned', 'unassigned', 'matter_created')),
  -- The person an assignment entry is about.
  subject_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint request_desk_comments_request_fkey
    foreign key (request_id, org_id)
    references public.request_desk_requests (id, org_id) on delete cascade,
  constraint request_desk_comments_shape_check check (
    (kind = 'comment' and char_length(btrim(body)) > 0
      and from_status is null and to_status is null and event is null)
    or (kind = 'status_change' and from_status is not null and to_status is not null
      and from_status <> to_status and event is null)
    or (kind = 'system' and event is not null
      and from_status is null and to_status is null)
  )
);

create index if not exists request_desk_comments_request
  on public.request_desk_comments (request_id, created_at);
create index if not exists request_desk_comments_org
  on public.request_desk_comments (org_id, created_at);
create index if not exists request_desk_comments_author
  on public.request_desk_comments (author_user_id)
  where author_user_id is not null;
create index if not exists request_desk_comments_subject
  on public.request_desk_comments (subject_user_id)
  where subject_user_id is not null;

create table if not exists public.request_desk_counters (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  last_number integer not null default 0
    constraint request_desk_counters_last_number_check check (last_number >= 0),
  updated_at timestamptz not null default now()
);

alter table public.request_desk_requests enable row level security;
alter table public.request_desk_comments enable row level security;
alter table public.request_desk_counters enable row level security;

revoke all on public.request_desk_requests from anon, authenticated;
revoke all on public.request_desk_comments from anon, authenticated;
revoke all on public.request_desk_counters from anon, authenticated;

-- Requests are created through request_desk_create_request; the backend reads
-- them and edits their details. Comments are read and added. The counters are
-- touched only by request_desk_create_request.
revoke all on public.request_desk_requests from service_role;
revoke all on public.request_desk_comments from service_role;
revoke all on public.request_desk_counters from service_role;
grant select, update on public.request_desk_requests to service_role;
grant select, insert on public.request_desk_comments to service_role;

-- ---------------------------------------------------------------------------
-- Integrity: a request stays in its organization, which must be an active
-- team organization when it is created; an assignee is a member; a matter
-- belongs to the same organization. The backend checks all of these first,
-- so a refusal here is a race or a bug, never the normal path.
-- ---------------------------------------------------------------------------

create or replace function public.request_desk_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_assignee boolean;
  v_check_project boolean;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.organizations o
       where o.id = new.org_id and o.kind = 'team' and o.deleted_at is null
    ) then
      raise exception 'request desk: requests belong to an active team organization'
        using errcode = 'check_violation';
    end if;
    v_check_assignee := new.assignee_user_id is not null;
    v_check_project := new.project_id is not null;
  else
    if new.org_id is distinct from old.org_id then
      raise exception 'request desk: a request cannot move to another organization'
        using errcode = 'check_violation';
    end if;
    -- Clearing a person or a matter (including ON DELETE SET NULL) is always
    -- allowed; only a new value is checked.
    v_check_assignee := new.assignee_user_id is not null
      and new.assignee_user_id is distinct from old.assignee_user_id;
    v_check_project := new.project_id is not null
      and new.project_id is distinct from old.project_id;
  end if;
  if v_check_assignee and not exists (
    select 1 from public.org_members m
     where m.org_id = new.org_id and m.user_id = new.assignee_user_id
  ) then
    raise exception 'request desk: the assignee is not a member of the organization'
      using errcode = 'check_violation';
  end if;
  if v_check_project and not exists (
    select 1 from public.projects p
     where p.id = new.project_id and p.org_id = new.org_id
  ) then
    raise exception 'request desk: the matter belongs to another workspace'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists request_desk_requests_guard on public.request_desk_requests;
create trigger request_desk_requests_guard
  before insert or update of org_id, assignee_user_id, project_id
  on public.request_desk_requests
  for each row execute function public.request_desk_requests_guard();

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

-- Create a request with the organization's next reference. The counter row is
-- locked by the upsert until this transaction ends, so concurrent creates in
-- one organization get distinct, consecutive numbers; a create that fails
-- rolls its number back with it. An initial assignee gets its trail entry in
-- the same transaction.
create or replace function public.request_desk_create_request(
  p_org_id uuid,
  p_created_by uuid,
  p_source text,
  p_title text,
  p_details text,
  p_request_type text,
  p_priority text,
  p_requester_name text,
  p_requester_email text,
  p_assignee_user_id uuid,
  p_sla_due_at timestamptz
)
returns public.request_desk_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
  v_request public.request_desk_requests;
begin
  insert into public.request_desk_counters as c (org_id, last_number)
  values (p_org_id, 1)
  on conflict (org_id) do update
    set last_number = c.last_number + 1,
        updated_at = now()
  returning c.last_number into v_number;

  insert into public.request_desk_requests (
    org_id, reference_number, source, title, details, request_type, priority,
    requester_name, requester_email, assignee_user_id, sla_due_at, created_by
  ) values (
    p_org_id, v_number, coalesce(p_source, 'internal'), btrim(p_title),
    coalesce(p_details, ''), p_request_type, coalesce(p_priority, 'normal'),
    p_requester_name, p_requester_email, p_assignee_user_id, p_sla_due_at,
    p_created_by
  )
  returning * into v_request;

  if p_assignee_user_id is not null then
    insert into public.request_desk_comments (
      request_id, org_id, author_user_id, kind, event, subject_user_id
    ) values (
      v_request.id, p_org_id, p_created_by, 'system', 'assigned', p_assignee_user_id
    );
  end if;

  return v_request;
end;
$$;

-- Move a request to another status with its status_change entry, in one
-- transaction. closed_at is set on entering closed or declined, kept between
-- those two, and cleared on reopening. Returns
--   {outcome: 'not_found'}
--   {outcome: 'conflict', request}    p_expected_status no longer holds
--   {outcome: 'unchanged', request}   already in p_status: nothing written
--   {outcome: 'changed', request, comment}
create or replace function public.request_desk_change_status(
  p_request_id uuid,
  p_org_id uuid,
  p_actor_id uuid,
  p_status text,
  p_note text,
  p_expected_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.request_desk_requests;
  v_updated public.request_desk_requests;
  v_comment public.request_desk_comments;
  v_terminal constant text[] := array['closed', 'declined'];
begin
  if p_status is null
     or p_status not in ('new', 'in_progress', 'waiting', 'closed', 'declined') then
    raise exception 'request desk: unknown status'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_current
    from public.request_desk_requests
   where id = p_request_id and org_id = p_org_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_expected_status is not null and v_current.status <> p_expected_status then
    return jsonb_build_object('outcome', 'conflict', 'request', to_jsonb(v_current));
  end if;
  if v_current.status = p_status then
    return jsonb_build_object('outcome', 'unchanged', 'request', to_jsonb(v_current));
  end if;

  update public.request_desk_requests
     set status = p_status,
         closed_at = case
           when not (p_status = any (v_terminal)) then null
           when v_current.status = any (v_terminal) then v_current.closed_at
           else now()
         end,
         updated_at = now()
   where id = p_request_id
  returning * into v_updated;

  insert into public.request_desk_comments (
    request_id, org_id, author_user_id, kind, body, from_status, to_status
  ) values (
    p_request_id, p_org_id, p_actor_id, 'status_change',
    coalesce(btrim(p_note), ''), v_current.status, p_status
  )
  returning * into v_comment;

  return jsonb_build_object(
    'outcome', 'changed',
    'request', to_jsonb(v_updated),
    'comment', to_jsonb(v_comment)
  );
end;
$$;

-- Assign a request (or clear its assignee, with p_assignee_user_id null) and
-- record the system entry, in one transaction. With p_only_if_unassigned, a
-- request that already has an assignee is left alone: that is how a member
-- takes an unassigned request without overwriting a colleague who took it
-- first. Returns the same outcomes as request_desk_change_status.
create or replace function public.request_desk_assign(
  p_request_id uuid,
  p_org_id uuid,
  p_actor_id uuid,
  p_assignee_user_id uuid,
  p_only_if_unassigned boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.request_desk_requests;
  v_updated public.request_desk_requests;
  v_comment public.request_desk_comments;
begin
  select * into v_current
    from public.request_desk_requests
   where id = p_request_id and org_id = p_org_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if coalesce(p_only_if_unassigned, false) and v_current.assignee_user_id is not null then
    return jsonb_build_object('outcome', 'conflict', 'request', to_jsonb(v_current));
  end if;
  if v_current.assignee_user_id is not distinct from p_assignee_user_id then
    return jsonb_build_object('outcome', 'unchanged', 'request', to_jsonb(v_current));
  end if;

  update public.request_desk_requests
     set assignee_user_id = p_assignee_user_id,
         updated_at = now()
   where id = p_request_id
  returning * into v_updated;

  insert into public.request_desk_comments (
    request_id, org_id, author_user_id, kind, event, subject_user_id
  ) values (
    p_request_id, p_org_id, p_actor_id, 'system',
    case when p_assignee_user_id is null then 'unassigned' else 'assigned' end,
    coalesce(p_assignee_user_id, v_current.assignee_user_id)
  )
  returning * into v_comment;

  return jsonb_build_object(
    'outcome', 'changed',
    'request', to_jsonb(v_updated),
    'comment', to_jsonb(v_comment)
  );
end;
$$;

-- Link the matter created from a request, once, with its system entry.
-- Returns not_found, conflict (a matter is already linked) or changed.
create or replace function public.request_desk_link_matter(
  p_request_id uuid,
  p_org_id uuid,
  p_actor_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.request_desk_requests;
  v_updated public.request_desk_requests;
  v_comment public.request_desk_comments;
begin
  select * into v_current
    from public.request_desk_requests
   where id = p_request_id and org_id = p_org_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_current.project_id is not null then
    return jsonb_build_object('outcome', 'conflict', 'request', to_jsonb(v_current));
  end if;

  update public.request_desk_requests
     set project_id = p_project_id,
         updated_at = now()
   where id = p_request_id
  returning * into v_updated;

  insert into public.request_desk_comments (
    request_id, org_id, author_user_id, kind, event
  ) values (
    p_request_id, p_org_id, p_actor_id, 'system', 'matter_created'
  )
  returning * into v_comment;

  return jsonb_build_object(
    'outcome', 'changed',
    'request', to_jsonb(v_updated),
    'comment', to_jsonb(v_comment)
  );
end;
$$;

-- Counts for an organization's triage board. Open means new, in progress or
-- waiting; overdue means open with a due date in the past.
create or replace function public.request_desk_board_summary(
  p_org_id uuid,
  p_user_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where r.status in ('new', 'in_progress', 'waiting')),
    'overdue', count(*) filter (
      where r.status in ('new', 'in_progress', 'waiting') and r.sla_due_at < now()
    ),
    'unassigned', count(*) filter (
      where r.status in ('new', 'in_progress', 'waiting') and r.assignee_user_id is null
    ),
    'assigned_to_me', count(*) filter (
      where r.status in ('new', 'in_progress', 'waiting') and r.assignee_user_id = p_user_id
    ),
    'by_status', jsonb_build_object(
      'new', count(*) filter (where r.status = 'new'),
      'in_progress', count(*) filter (where r.status = 'in_progress'),
      'waiting', count(*) filter (where r.status = 'waiting'),
      'closed', count(*) filter (where r.status = 'closed'),
      'declined', count(*) filter (where r.status = 'declined')
    ),
    'open_by_priority', jsonb_build_object(
      'low', count(*) filter (
        where r.priority = 'low' and r.status in ('new', 'in_progress', 'waiting')
      ),
      'normal', count(*) filter (
        where r.priority = 'normal' and r.status in ('new', 'in_progress', 'waiting')
      ),
      'high', count(*) filter (
        where r.priority = 'high' and r.status in ('new', 'in_progress', 'waiting')
      ),
      'urgent', count(*) filter (
        where r.priority = 'urgent' and r.status in ('new', 'in_progress', 'waiting')
      )
    )
  )
  from public.request_desk_requests r
  where r.org_id = p_org_id;
$$;

revoke all on function public.request_desk_requests_guard()
  from public, anon, authenticated;
revoke all on function public.request_desk_create_request(
  uuid, uuid, text, text, text, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.request_desk_change_status(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.request_desk_assign(
  uuid, uuid, uuid, uuid, boolean
) from public, anon, authenticated;
revoke all on function public.request_desk_link_matter(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.request_desk_board_summary(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.request_desk_create_request(
  uuid, uuid, text, text, text, text, text, text, text, uuid, timestamptz
) to service_role;
grant execute on function public.request_desk_change_status(
  uuid, uuid, uuid, text, text, text
) to service_role;
grant execute on function public.request_desk_assign(
  uuid, uuid, uuid, uuid, boolean
) to service_role;
grant execute on function public.request_desk_link_matter(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.request_desk_board_summary(uuid, uuid)
  to service_role;
