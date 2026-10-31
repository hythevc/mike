-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
--
-- AI usage ledger: one row per model call. A row says who made the call, in
-- which workspace and matter, from which surface, on which model and
-- provider, whose credential paid for it (the person's own key, their
-- organization's key, or the deployment's own), and the tokens and document
-- pages it used. Nothing from the prompt or the answer is stored.
--
-- Every row belongs to an organization and goes with it. Work outside a team
-- organization is counted under the person's own (personal) organization,
-- which the insert trigger fills in when the backend leaves org_id empty, so
-- deleting the account deletes that history. In a team organization the
-- history stays with the organization: deleting an account or a matter only
-- clears the link to it.
--
-- usage_monthly_rollup totals one workspace's calendar month (UTC). The
-- backend reads it to apply DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP before a call
-- that would use the deployment's keys.
--
-- Only the backend reads or writes the ledger: RLS is on with no policies,
-- and the browser roles hold no privileges on the table or the functions.
--
-- Safe to re-run: create table / index if not exists, create or replace for
-- the functions, drop-before-create for the trigger.

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  surface text not null
    constraint usage_events_surface_check
    check (surface in ('chat', 'project_chat', 'word', 'tabular', 'playbook', 'title', 'subagent', 'memory')),
  model text not null
    constraint usage_events_model_check check (char_length(model) between 1 and 200),
  provider text not null
    constraint usage_events_provider_check check (char_length(provider) between 1 and 50),
  key_source text not null
    constraint usage_events_key_source_check check (key_source in ('user', 'org', 'env')),
  input_tokens bigint not null default 0
    constraint usage_events_input_tokens_check check (input_tokens >= 0),
  output_tokens bigint not null default 0
    constraint usage_events_output_tokens_check check (output_tokens >= 0),
  -- Input tokens served from the provider's prompt cache; part of input_tokens.
  cached_tokens bigint not null default 0
    constraint usage_events_cached_tokens_check check (cached_tokens >= 0),
  -- Pages of the documents the call read, when they are known.
  document_pages integer
    constraint usage_events_document_pages_check
    check (document_pages is null or document_pages >= 0),
  -- What the call was part of. Attribution only, like audit_events: these
  -- outlive the chat, review, run or document they name.
  chat_id uuid,
  review_id uuid,
  run_id uuid,
  document_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_org_created
  on public.usage_events(org_id, created_at desc);
create index if not exists usage_events_user_created
  on public.usage_events(user_id, created_at desc)
  where user_id is not null;
create index if not exists usage_events_project_created
  on public.usage_events(project_id, created_at desc)
  where project_id is not null;

alter table public.usage_events enable row level security;
revoke all on public.usage_events from public, anon, authenticated;
grant select, insert, update, delete on public.usage_events to service_role;

-- A row the backend files without an organization is personal work: it
-- belongs to the person's own organization.
create or replace function public.usage_events_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.org_id is null and new.user_id is not null then
    select o.id into new.org_id
    from public.organizations o
    where o.personal_user_id = new.user_id;
    if new.org_id is null then
      new.org_id := public.ensure_personal_organization(new.user_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists usage_events_scope on public.usage_events;
create trigger usage_events_scope
  before insert on public.usage_events
  for each row execute function public.usage_events_scope();

-- One workspace's usage for the calendar month (UTC) containing p_month, by
-- key source, surface, provider and model. The workspace is p_org_id, or the
-- personal organization of p_user_id when p_org_id is null.
create or replace function public.usage_monthly_rollup(
  p_org_id uuid,
  p_user_id uuid default null,
  p_month timestamptz default now()
)
returns table (
  key_source text,
  surface text,
  provider text,
  model text,
  events bigint,
  input_tokens bigint,
  output_tokens bigint,
  cached_tokens bigint,
  document_pages bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    e.key_source,
    e.surface,
    e.provider,
    e.model,
    count(*)::bigint,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.cached_tokens), 0)::bigint,
    coalesce(sum(e.document_pages), 0)::bigint
  from public.usage_events e
  where e.org_id = coalesce(
      p_org_id,
      (select o.id from public.organizations o where o.personal_user_id = p_user_id)
    )
    and e.created_at >= date_trunc('month', p_month at time zone 'UTC') at time zone 'UTC'
    and e.created_at < (date_trunc('month', p_month at time zone 'UTC') + interval '1 month') at time zone 'UTC'
  group by e.key_source, e.surface, e.provider, e.model
  order by e.key_source, e.surface, e.provider, e.model;
$$;

revoke all on function public.usage_events_scope()
  from public, anon, authenticated;
revoke all on function public.usage_monthly_rollup(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.usage_events_scope() to service_role;
grant execute on function public.usage_monthly_rollup(uuid, uuid, timestamptz)
  to service_role;
