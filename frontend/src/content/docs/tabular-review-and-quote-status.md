<!-- SPDX-License-Identifier: AGPL-3.0-only -->

> This is legal information, not legal advice. A quote status says what the software checked; it never says that an answer is right.

A tabular review asks the same questions of many documents and shows the answers as a table: one row per document, one column per question. Each answer cites the passage it relied on with a short quote. When an answer is finished, the quote is matched against the text extracted from the document it cites, and the result is stored with the answer and shown on the cell.

## What each status means

| Status shown on the cell | Meaning |
| --- | --- |
| Quote found | Every quote in the answer was found in the text of the document it cites. |
| Partly found | Some of the quoted text was found and some was not. Check the source. |
| Quote not found - check source | None of the quoted text was found in the source. Check the source before relying on the answer. |
| No quote | The answer cites no quote, so there was nothing to match. |
| No readable text | A source document of the row yielded no extractable text, for example a scanned file without a text layer, so the row was not answered. |
| Stale | A source document has changed since the answer was written. Re-run the cell to check it against the current text. |

The table header counts the quotes across the review, for example "37 of 40 quotes found", and counts rows without readable text separately. "Show cells to check" narrows the table to cells whose quote was not fully found or whose source has changed.

## How quotes are matched

Matching ignores differences in spacing, letter case, quotation marks, dashes, ligatures and invisible characters, and a line-break hyphen inside a word. It does not ignore differences that change meaning: a match has to start and end where a word or number does, so a shorter number inside a longer one, a word inside a negated form of it, or a different currency symbol does not count as found.

## Opening a cell

Opening a cell shows the answer, its reasoning, and each quote beside the passage of the source it matched. The panel says which page the citation named and that the page itself was not checked: only the quoted words are matched, not where the model said they were.

## What is not checked

- The page, sheet or cell a citation names. Only the quoted words are matched against the document's text.
- Whether the answer is right. A found quote shows that the words are in the source, not that they support the conclusion drawn from them.
- Scanned pages without a text layer. They are reported as having no readable text rather than treated as empty.

## Stale cells

When a document in the review is replaced by a new version, the cells drawn from it are marked stale, because even a quote that once matched may no longer be in the text. Re-running a stale cell checks it against the current version.

## Export

The Excel export keeps the evidence: every cell's quote, its status, its flags and its reasoning travel with the answer, an Evidence sheet lists the quotes and the passages they matched, and each sheet carries the line "Legal information, not legal advice. Verify before relying."
