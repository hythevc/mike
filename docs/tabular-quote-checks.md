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
| `partly_found` | Some quoted text was found and some was not. For a quote with omissions, its parts were not all found together, in order. |
| `not_found` | No quote was found. |
| `no_quote` | The answer carries no quote. |
| `no_text` | A source document of the row yielded no extractable text, so the row was not answered. |

Each quote also carries its own `found`, `partly_found` or `not_found` status,
the exact source text it matched, and up to about 160 characters of source text
on either side of the match.

A cell whose check could not run keeps its answer with a null `quote_status`
and is counted as unchecked. It still records the document versions it was
drawn from, so it can be reported stale.

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
least eight letters and digits it also ignores spacing and the punctuation that
cannot change what a number says, so a stray comma, a missing space or a
line-break hyphen does not hide a real quote.

Some differences always count, because they change what the quote says:

- A match has to start and end where a word or a number starts and ends.
  "5 days" is not found in "15 days", "2.5%" is not found in "12.5%",
  "10,000.00" is not found in "110,000.00", "enforceable" is not found in
  "unenforceable" (nor in "un-" ending one line and "enforceable" starting the
  next), and "exclusive" is not found in "non-exclusive".
- A sign directly before a number belongs to it: "0.50%" is not found in
  "-0.50%".
- Punctuation between two digits counts: `$10,000.00` never matches
  `$1,000,000`.
- Currency, percent, comparison and arithmetic symbols count: "€10,000" is not
  found in "$10,000", and "≥ 3.50" is not found in "≤ 3.50".
- Two numbers stay two numbers: "Sections 12 and 13" is not found in
  "Sections 1, 2 and 13".

Letters are checked at word edges only in scripts that put spaces between
words. In Chinese, Japanese, Thai and similar text, a quote can match inside a
run of characters; digits are still checked there.

These rules catch a word or number that was cut or changed at the edge of a
quote, and a changed symbol or separator inside it. They do not catch every
paraphrase: a quote whose words all appear verbatim in the source is found,
even where the surrounding text qualifies them.

## Quotes with omissions

A quote can mark left-out text with `...`, `…`, the spaced `. . .`, or any of
these in square or round brackets (`[...]`, `[…]`, `(…)`). Its parts are found
only when they appear in the source in the quote's order, each starting within
2,000 characters of the end of the part before it. The search does not give up
on long documents: a part that repeats many times before the passage quoted
(such as "The Tenant shall") does not stop the quote from being found.

## Which document a quote is checked against

A quote is checked only against the document it cites. A citation that names
no document, as older answers do, is checked against each of the row's sources
in turn. A citation that names a document outside the row is `not_found`; its
`document_id` is null, and the reference the answer wrote is kept in
`cited_reference` for display only.

## Rows without text

When any source of a row yields no extractable text (a scanned file without a
text layer, or an encrypted or damaged file whose text cannot be read), the row
is not sent to the model. Its cells finish with an empty answer and the status
`no_text`, so no cell reads as a "Not Found" that was looked for and missed. In
a folder row this applies when any one file has no text, because an answer
drawn from the other files could miss what that file says. These rows are
counted on their own in the review's `quote_summary` and add nothing to its
quote counts. The review grid and its Excel export show such a cell as "No
readable text".

A source whose extraction fails outright (a conversion error, or a stored file
that cannot be read) is not `no_text`. The row is not answered, its cells end
in error, and the next run tries the extraction again.

## Stale cells

Each cell records the version of every source document whose text it read,
with that version's content hash. The review detail endpoint reports a cell as
`stale` when a source has a newer active version, when the active version was
changed in place (accepting a tracked change does this), or when a source has
been deleted. Regenerating the cell checks it again.

## API

- `GET /tabular-review/:reviewId` returns, on each cell, `quote_status`,
  `quote_outcomes` (each quote's field, status and, for a quote with
  omissions, its part counts), `no_text_document_ids`, `stale` and
  `stale_document_ids`, and on the response, `quote_summary`. It carries no
  quote text or source passages, which keeps it small on large reviews.
- `GET /tabular-review/:reviewId/quote-checks` returns the checked cells'
  quotes in full: each quote, the source text it matched and the text around
  it. `row_id` and `column_index` narrow it to one row or one cell. Like the
  detail endpoint, it only covers rows whose every source the caller may read.
- The `cell_update` frames of the generate streams carry `quote_status` and
  `quote_outcomes` for finished cells, and no quote text, source passages or
  document ids. A reader that attaches to a run someone else started sees only
  the frames of rows whose every source it may read.

The types are in `packages/contracts/index.d.ts`: `TabularQuoteStatus`,
`TabularQuoteCheck`, `TabularQuoteOutcome`, `TabularCellQuoteStatus`,
`TabularCellQuoteFields`, `TabularCellQuoteChecks`,
`TabularQuoteChecksResponse`, `TabularCellStaleness` and
`TabularQuoteSummary`. Cells answered before quote checks existed have a null
`quote_status` until they are regenerated.

A person's data export keeps each cell's answer and `quote_status`, but not the
stored source passages or the record of document versions.

The matcher lives in `backend/src/lib/citations/sourceMatcher.ts` and
`boundaries.ts`. Chat citation verification keeps its own matcher in
`quoteMatch.ts`. The cell checks live in
`backend/src/modules/tabular/tabular.verify.ts`.
