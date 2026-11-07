-- Migration date: 2026-11-07
--
-- Matter AI controls (W18).
--
-- 1. A matter (project) can have AI switched off at its client's request.
--    Model work on a restricted matter is refused before any provider call
--    (backend/src/lib/matterAi.ts). The columns record who switched it off
--    and when; ai_restricted_by goes null if that account is deleted, so the
--    restriction survives as history.
-- 2. Outbound connector writes wait for the user's approval by default. New
--    connector rows now default require_write_approval to true; existing rows
--    keep whatever they were set to (this only changes the column default).

alter table public.projects
  add column if not exists ai_restricted boolean not null default false,
  add column if not exists ai_restricted_reason text,
  add column if not exists ai_restricted_by uuid references auth.users(id) on delete set null,
  add column if not exists ai_restricted_at timestamptz;

alter table public.user_mcp_connectors
  alter column require_write_approval set default true;
alter table public.user_google_drive_tokens
  alter column require_write_approval set default true;
alter table public.user_google_workspace_tokens
  alter column require_write_approval set default true;
