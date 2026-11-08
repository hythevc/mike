-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-11-08
--
-- Billing webhook ledger (BILLING_ENABLED).
--
-- The billing provider delivers each event at least once and in no fixed
-- order, so the webhook handler records every event id it accepts before it
-- acts on it. A redelivery finds the row and is answered without being
-- processed again; a delivery whose processing fails has its row removed
-- again, so the provider's retry is processed afresh.
--
--   billing_events   one row per accepted provider event
--
-- Only the event's id and type are kept, never its payload: the payload
-- names the customer and the amounts, and the handler has already applied
-- what it needs to org_subscriptions by the time the row is complete.
-- processed_at is null while the event is being handled.
--
-- The backend is the only client. Row level security is on with no
-- policies, the browser roles get nothing, and service_role gets exactly
-- what the handler does through PostgREST: insert the claim, update it on
-- completion, delete it on failure, and read it to answer a redelivery.
--
-- Safe to re-run: create ... if not exists throughout.

create table if not exists public.billing_events (
  -- The provider's event id, e.g. evt_… — the idempotency key.
  event_id text primary key
    constraint billing_events_event_id_check
    check (char_length(event_id) between 1 and 255),
  -- The provider's event type, e.g. invoice.payment_failed.
  type text not null
    constraint billing_events_type_check
    check (char_length(type) between 1 and 100),
  received_at timestamptz not null default now(),
  -- Set once the event's effect on org_subscriptions has been applied.
  processed_at timestamptz
);

create index if not exists billing_events_received_at_idx
  on public.billing_events (received_at);

alter table public.billing_events enable row level security;
revoke all on public.billing_events from public, anon, authenticated;
grant select, insert, update, delete on public.billing_events to service_role;
