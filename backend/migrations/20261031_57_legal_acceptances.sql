-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
--
-- Legal acceptances: one row each time a user accepts a version of a legal
-- document. Onboarding is not complete until the user has accepted the
-- current Terms and Privacy versions, so email, Google and SSO sign-ups all
-- record their acceptance, and a version change asks for it again.
--
--   user_legal_acceptances   user_id, document, version, sign_in_method,
--                            accepted_at (append-only; never updated)
--
-- Deleting the account removes its acceptances (user_id cascades). The
-- backend is the only client: row level security is on with no policies,
-- anon and authenticated get nothing, and service_role gets select and
-- insert only.
--
-- Safe to re-run: create ... if not exists.

create table if not exists public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The key of the document in the brand configuration, e.g. 'terms'.
  document text not null
    constraint user_legal_acceptances_document_check
      check (char_length(btrim(document)) between 1 and 64),
  -- The version string the user was shown and accepted, e.g. '1.2.0'.
  version text not null
    constraint user_legal_acceptances_version_check
      check (char_length(btrim(version)) between 1 and 32),
  -- How the user was signing in when they accepted.
  sign_in_method text not null default 'unknown'
    constraint user_legal_acceptances_sign_in_method_check
      check (sign_in_method in ('password', 'google', 'sso', 'unknown')),
  accepted_at timestamptz not null default now()
);

-- Find a user's most recent acceptance of a document quickly.
create index if not exists user_legal_acceptances_user_document
  on public.user_legal_acceptances (user_id, document, accepted_at desc);

alter table public.user_legal_acceptances enable row level security;

revoke all on public.user_legal_acceptances from anon, authenticated;
revoke all on public.user_legal_acceptances from service_role;
grant select, insert on public.user_legal_acceptances to service_role;
