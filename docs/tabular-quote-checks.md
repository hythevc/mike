<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Tabular review quote checks

Each answer in a tabular review cites its sources inline, with a short quote
for every claim: `[[document:ID||page:N||quote:...]]`, or a sheet and cell for
spreadsheets. When a cell's answer is finished, the backend matches every quote
in the answer's summary and reasoning against the text extracted from the
document that the quote cites. That is the same text the model read for the
row. The result is stored with the answer.

## What a status means

| Status | Meaning |
| --- | --- |
| `found` | Every quote was found in the text of the document it cites. |
| `partly_found` | Some quoted text was found and some was not. For a quote with omissions (`...` or `…`), its parts were not all found together, in order. |
| `not_found` | No quote was found. |
| `no_quote` | The answer carries no quote. |
| `no_text` | A source document of the row yielded no extractable text, so the row was not answered. |

Each quote also carries its own `found`, `partly_found` or `not_found` status,
the exact source text it matched, and up to about 160 characters of source text
on either side of the match.

## What is not checked

- The page, sheet or cell that a citation names. Only the quoted words are
  matched.
- Whether the answer is right. A found quote shows that the words are in the
  source document, not that they support the answer.

Labels shown to users should describe what was checked, for example "Quote
found in source", and should not say "verified" or "accurate".

## How quotes are matched

Matching ignores differences in whitespace, letter case, quote characters and
apostrophes, dash characters, ligatures and soft hyphens. For a quote with at
least eight letters and digits it also ignores other punctuation and spacing, so
a stray comma or a line-break hyphen does not hide a real quote. Punctuation
between two digits always counts: `$10,000.00` never matches `$1,000,000`.

A quote with omissions is found only when its parts appear in the source in the
quote's order, each within 2,000 characters of the part before it.

A quote is checked only against the document it cites. A citation that names
no document, as older answers do, is checked against each of the row's sources
in turn. A citation that names a document outside the row is `not_found`.

## Rows without text

When any source of a row yields no extractable text (a scanned file without a
text layer, or an encrypted or damaged file), the row is not sent to the model.
Its cells finish with an empty answer and the status `no_text`, so no cell
reads as a "Not Found" that was looked for and missed. In a folder row this
applies when any one file is unreadable, because an answer drawn from the other
files could miss what that file says. These rows are counted on their own in
the review's `quote_summary` and add nothing to its quote counts.

## Stale cells

Each cell records the version of every source document whose text it read,
with that version's content hash. The review detail endpoint reports a cell as
`stale` when a source has a newer active version, when the active version was
changed in place (accepting a tracked change does this), or when a source has
been deleted. Regenerating the cell checks it again.

## API

- `GET /tabular-review/:reviewId` returns, on each cell, `quote_status`,
  `quote_checks`, `no_text_document_ids`, `stale` and `stale_document_ids`, and
  on the response, `quote_summary`.
- The `cell_update` frames of the generate streams carry `quote_status`,
  `quote_checks` and `no_text_document_ids` for finished cells.

The types are in `packages/contracts/index.d.ts`: `TabularQuoteStatus`,
`TabularQuoteCheck`, `TabularCellQuoteFields`, `TabularCellStaleness` and
`TabularQuoteSummary`. Cells answered before quote checks existed have a null
`quote_status` until they are regenerated.

The matcher lives in `backend/src/lib/citations/`, which chat citation
verification also uses. The cell checks live in
`backend/src/modules/tabular/tabular.verify.ts`.
