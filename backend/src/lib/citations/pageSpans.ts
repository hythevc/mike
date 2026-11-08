// SPDX-License-Identifier: AGPL-3.0-only
//
// Map the character spans of each page in extracted document text, from the
// line-anchored `[Page N]` markers that `lib/pdfText.ts` emits. Used by chat
// citation verification to tell whether a quote sits on the page it was cited
// to. It fails closed: unless the markers run 1, 2, 3, ... with none missing,
// repeated, or out of order, it returns null and the caller treats the page as
// unchecked. A document line that merely reads like a marker (for example a
// quoted "[Page 2]"), a `[Page N form fields]` line, and the no-text-layer
// notice are therefore never mistaken for a real page boundary.

/** Half-open character span of one page in the source text: `[start, end)`. */
export type PageSpan = { start: number; end: number };

// A page boundary is a whole line that is exactly `[Page N]`. `[Page 3 form
// fields]` and `[Page 2 of this PDF has no text layer...]` have trailing text
// after the number, so they do not match. A trailing `\r` is tolerated for
// CRLF-encoded text, though the extractor joins pages with `\n`.
const PAGE_MARKER_LINE = /^\[Page (\d+)\]\r?$/;

/**
 * Return one `PageSpan` per page (index 0 is page 1), or null when the source
 * has no reliable `[Page N]` sequence. The markers must be 1..N in order with
 * no gaps, repeats, or reordering; any deviation returns null so a caller
 * never checks a quote against a page the text cannot locate.
 */
export function pageSpans(source: string): PageSpan[] | null {
  if (!source) return null;

  const markers: number[] = [];
  const starts: number[] = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    const match = PAGE_MARKER_LINE.exec(line);
    if (match) {
      markers.push(Number(match[1]));
      starts.push(offset);
    }
    // +1 restores the "\n" that split() consumed. The running total overshoots
    // by one past the final line, which is never read.
    offset += line.length + 1;
  }

  if (markers.length === 0) return null;
  for (let i = 0; i < markers.length; i += 1) {
    if (markers[i] !== i + 1) return null;
  }

  return starts.map((start, index) => ({
    start,
    end: index + 1 < starts.length ? starts[index + 1] : source.length,
  }));
}

/**
 * The 1-based page number whose span contains `offset`, or null when it falls
 * in no span (for example a negative offset). `spans` comes from `pageSpans`.
 */
export function pageForOffset(
  spans: PageSpan[],
  offset: number,
): number | null {
  for (let i = 0; i < spans.length; i += 1) {
    if (offset >= spans[i].start && offset < spans[i].end) return i + 1;
  }
  return null;
}
