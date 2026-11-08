# Chat citation checks

Every citation a chat answer makes is checked against the source text on the
server before it reaches the reader. This page says what is checked, and —
just as importantly — what is not, so a reader never mistakes a green-looking
answer for a verified one.

These checks describe what the system compared. They are not a judgment that an
answer is correct. Labels never say "verified" or "accurate", and every
finished answer carries the line: "AI reading aid over your documents. Legal
information, not legal advice. Check each citation before relying on it."

## What the quote check does

For each document citation the model emits, the server takes the quoted text
and looks for it in the document's extracted text, in three passes:

1. exact substring;
2. whitespace- and case-tolerant;
3. punctuation-tolerant.

A quote found in any pass is marked found, and the exact source text is swapped
in so the reader never sees drifted wording. A quote found nowhere is left
unmatched and shown as "Quote not found - check source". A quote abbreviated
with an ellipsis, or spanning a page break, has each segment checked in order.

## What the page check does

When a document has a reliable `[Page N]` sequence — currently only PDFs whose
pages extract as line-anchored `[Page 1]`, `[Page 2]`, ... markers — the server
also checks whether each found quote sits on the page the model cited:

- on its cited page (or inside its cited `N-M` range): no correction;
- on a different page: the citation's target page is moved to the page the
  quote was actually found on, so the source opens there, and the citation
  reports "Quote is on p. 5, not p. 4";
- a quote the model cited with no page is shown on the page it was found on.

## What is not checked

The page check needs the `[Page N]` markers above, so it does not run for:

- **DOCX and other inline Word text**, which carry no page markers. The quote
  is still checked; the page is marked "Page not checked".
- **Spreadsheets**, which are located by sheet and cell (for example
  `Sheet1!B7`), not by page. The quote is checked against the cell's text; the
  sheet and cell locator themselves are not checked.
- **Slides** and any other source without a reliable page sequence.

A PDF whose markers do not run cleanly as `1, 2, 3, ...` (one repeated, missing,
or out of order — including a document line that merely reads like a marker)
fails closed: its pages are treated as not checked rather than guessed.

Two further limits carry over from the rest of the product:

- the cited **sheet** and **cell** of a spreadsheet citation are not checked,
  only the quoted value;
- **tabular review** cells check the quote but say the page is not checked (see
  the tabular quote checks), so chat and tabular report page status
  differently on purpose.

## Documents-only answers

A chat turn can be asked to answer only from the documents in the conversation.
In that mode the assistant is given no web or case-law research tools and is
told to cite every statement about the documents, or, when they do not hold the
answer, to reply exactly "Not in these documents." An answer in this mode that
cites no document is flagged with a reminder to check it before relying on it.
