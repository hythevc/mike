-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-11-10
--
-- System theme preference. The appearance choice is three-valued now — System,
-- Light or Dark — but it stays in the existing boolean dark_mode column rather
-- than a new one, so the tiered profile select is untouched and existing users
-- keep their explicit value:
--
--   NULL   System (follow the device's prefers-color-scheme)
--   true   Dark
--   false  Light
--
-- Dropping the NOT NULL makes NULL representable; dropping the default makes a
-- new account start on System, because handle_new_user inserts a profile row
-- without naming dark_mode. Existing rows keep their explicit true/false, so
-- nobody's current theme changes.
--
-- Safe to re-run: dropping a NOT NULL that is already gone, or a default that
-- is already gone, is a no-op in Postgres.

alter table public.user_profiles
  alter column dark_mode drop not null;

alter table public.user_profiles
  alter column dark_mode drop default;
