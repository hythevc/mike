-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
--
-- A reviewer's decision on each finding of a playbook review: accepted,
-- overridden with a note, or escalated to a named colleague, made one finding
-- at a time or in bulk. A finding has at most one decision: changing it
-- replaces the row and clearing it deletes the row. Decisions go with their
-- run.
--
-- finding_key is the finding's id inside playbook_runs.findings_json. People
-- are referenced by account and become null when that account is deleted, so
-- the decision stays on the record without the person. A note can hold
-- privileged commentary, so like every backend-owned table this one is
-- reached only through the backend's service role: RLS is on with no
-- policies, and the browser roles hold no privileges.
--
-- Safe to re-run: every statement is guarded or idempotent.
create table if not exists public.playbook_finding_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.playbook_runs(id) on delete cascade,
  finding_key text not null,
  decision text not null,
  -- 'bulk' when it was accepted together with the run's other findings that
  -- met the standard position; 'single' otherwise.
  method text not null default 'single',
  note text,
  escalated_to uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint playbook_finding_decisions_run_finding_unique
    unique (run_id, finding_key),
  constraint playbook_finding_decisions_finding_key_check
    check (length(finding_key) between 1 and 200),
  constraint playbook_finding_decisions_decision_check
    check (decision in ('accepted', 'overridden', 'escalated')),
  constraint playbook_finding_decisions_method_check
    check (method in ('single', 'bulk')),
  -- Only acceptance is ever made in bulk.
  constraint playbook_finding_decisions_bulk_check
    check (method = 'single' or decision = 'accepted'),
  -- An override always records why.
  constraint playbook_finding_decisions_override_note_check
    check (decision <> 'overridden' or length(btrim(coalesce(note, ''))) > 0),
  constraint playbook_finding_decisions_note_length_check
    check (note is null or length(note) <= 4000)
);
-- Account deletion nulls these columns; the indexes keep that a lookup.
create index if not exists idx_playbook_finding_decisions_decided_by
  on public.playbook_finding_decisions(decided_by);
create index if not exists idx_playbook_finding_decisions_escalated_to
  on public.playbook_finding_decisions(escalated_to);

alter table public.playbook_finding_decisions enable row level security;
revoke all privileges on table public.playbook_finding_decisions
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.playbook_finding_decisions to service_role;
