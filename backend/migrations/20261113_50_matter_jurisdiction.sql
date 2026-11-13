-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-11-13
--
-- Matter jurisdiction profile (L1).
--
-- 1. A matter (project) records which jurisdictions it is about, which law
--    governs it and the language it is worked in. Jurisdictions are codes of
--    the registry in backend/src/lib/jurisdictions.ts (US, US_CA, EU); the
--    language is a tag from backend/src/lib/responseLanguages.ts.
-- 2. An organisation records the jurisdictions and the working language its
--    new matters start with.
--
-- The API checks that a code is in the registry and that a language is in
-- the list. The database checks only what it can hold without knowing
-- either: how many jurisdictions a row lists and the shape of a single code.
-- Adding a jurisdiction or a language therefore needs no migration.
--
-- Existing rows start with nothing recorded: an empty list, no governing law
-- and no working language.

alter table public.projects
  add column if not exists jurisdictions text[] not null default '{}',
  add column if not exists governing_law text,
  add column if not exists working_language text;

alter table public.projects
  drop constraint if exists projects_jurisdictions_limit;
alter table public.projects
  add constraint projects_jurisdictions_limit
    check (cardinality(jurisdictions) <= 10);

alter table public.projects
  drop constraint if exists projects_governing_law_format;
alter table public.projects
  add constraint projects_governing_law_format
    check (governing_law is null or governing_law ~ '^[A-Z]{2}(_[A-Z0-9]{1,3})?$');

alter table public.organizations
  add column if not exists default_jurisdictions text[] not null default '{}',
  add column if not exists default_working_language text;

alter table public.organizations
  drop constraint if exists organizations_default_jurisdictions_limit;
alter table public.organizations
  add constraint organizations_default_jurisdictions_limit
    check (cardinality(default_jurisdictions) <= 10);
