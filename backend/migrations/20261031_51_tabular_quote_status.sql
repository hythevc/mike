-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
-- Tabular cells record what their quotes were checked against.
--
-- quote_status: the outcome of matching the quotes in a cell's answer against
--   the text extracted from the source documents the model read. found: every
--   quote was found; partly_found: some quoted text was found and some was
--   not; not_found: no quote was found; no_quote: the answer has no quote;
--   no_text: a source yielded no extractable text, so the row was not
--   answered. Null until a finished answer has been checked, which includes
--   every answer written before this migration.
-- quote_checks: one entry per quote: where it appears, the document it cites,
--   its status and the source text it matched.
-- source_versions: for each source document, the version (and content hash)
--   whose text the answer was drawn from and whether it yielded text, so a
--   cell can report that a source has changed since.
--
-- One statement, so the three checks are validated in a single pass over the
-- table under the one lock it takes.

alter table public.tabular_cells
  add column if not exists quote_status text,
  add column if not exists quote_checks jsonb,
  add column if not exists source_versions jsonb,
  drop constraint if exists tabular_cells_quote_status_check,
  add constraint tabular_cells_quote_status_check check (
    quote_status is null
    or quote_status in ('found', 'partly_found', 'not_found', 'no_quote', 'no_text')
  ),
  drop constraint if exists tabular_cells_quote_checks_check,
  add constraint tabular_cells_quote_checks_check check (
    quote_checks is null or jsonb_typeof(quote_checks) = 'array'
  ),
  drop constraint if exists tabular_cells_source_versions_check,
  add constraint tabular_cells_source_versions_check check (
    source_versions is null or jsonb_typeof(source_versions) = 'object'
  );
