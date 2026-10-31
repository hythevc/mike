// SPDX-License-Identifier: AGPL-3.0-only
//
// Match many quotes against one source text. Used by the tabular quote checks,
// which check every quote in every cell of a row against the same extracted
// text, so each source is normalized once (lazily, per tier) rather than once
// per quote.
//
// A quote is located in three tiers, from strictest to most tolerant:
//   1. exact substring;
//   2. folded: whitespace collapsed, case, quote characters, dashes and
//      ligatures ignored (see `foldWithMap`);
//   3. tolerant: whitespace and punctuation ignored too, except punctuation
//      between digits. Only for quotes long enough that ignoring that much
//      cannot produce an accidental match.
// Offsets always index into the original source text, and `excerpt` is the
// exact source text that matched.

import { foldWithMap, type NormalizedText } from "./normalize";
import {
  locateSegmentsInOrder,
  splitQuoteSegments,
  type QuoteLocation,
} from "./quoteMatch";

/**
 * The tolerant tier ignores whitespace and most punctuation, so a quote has to
 * keep this many letters and digits for a tolerant match to mean anything.
 * Shorter quotes ("(i)", "§ 5", "Yes") match only exactly or folded.
 */
const MIN_TOLERANT_ALPHANUMERICS = 8;

/**
 * Omissions in a quote ("..." or "…") stand for words left out of one passage.
 * When the parts of a quote have to be found in order, consecutive parts must
 * start within this many characters of the previous part's end, so text
 * stitched together from distant clauses is not reported as found.
 */
export const DEFAULT_MAX_SEGMENT_GAP_CHARS = 2_000;

export type QuoteSource = {
  readonly text: string;
  /** First match of `quote`: an exact match, else a folded one, else a tolerant one. */
  locate(quote: string): QuoteLocation | null;
  /** The earliest match of `quote`, in any tier, that starts at or after `from`. */
  locateFrom(quote: string, from: number): QuoteLocation | null;
};

/** Index of the first normalized character that maps to `from` or later. */
function firstAtOrAfter(origIdx: number[], from: number): number {
  let low = 0;
  let high = origIdx.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (origIdx[mid] < from) low = mid + 1;
    else high = mid;
  }
  return low;
}

function countAlphanumerics(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

export function prepareQuoteSource(text: string): QuoteSource {
  let folded: NormalizedText | null = null;
  let tolerant: NormalizedText | null = null;
  const foldedText = () => (folded ??= foldWithMap(text));
  const tolerantText = () =>
    (tolerant ??= foldWithMap(text, { tolerant: true }));

  const locateIn = (
    index: NormalizedText,
    needle: string,
    from: number,
  ): QuoteLocation | null => {
    if (!needle) return null;
    const pos = index.norm.indexOf(needle, firstAtOrAfter(index.origIdx, from));
    if (pos < 0) return null;
    const start = index.origIdx[pos];
    const end = index.origIdx[pos + needle.length - 1] + 1;
    return { start, end, excerpt: text.slice(start, end) };
  };

  const tiers = (quote: string, from: number) => {
    const exact = (): QuoteLocation | null => {
      const index = text.indexOf(quote, from);
      return index >= 0
        ? { start: index, end: index + quote.length, excerpt: quote }
        : null;
    };
    const foldedMatch = () =>
      locateIn(foldedText(), foldWithMap(quote).norm.trim(), from);
    const tolerantMatch = () =>
      countAlphanumerics(quote) >= MIN_TOLERANT_ALPHANUMERICS
        ? locateIn(
            tolerantText(),
            foldWithMap(quote, { tolerant: true }).norm,
            from,
          )
        : null;
    return [exact, foldedMatch, tolerantMatch];
  };

  return {
    text,
    locate(quote) {
      if (!text || !quote) return null;
      for (const tier of tiers(quote, 0)) {
        const location = tier();
        if (location) return location;
      }
      return null;
    },
    locateFrom(quote, from) {
      if (!text || !quote || from >= text.length) return null;
      let earliest: QuoteLocation | null = null;
      for (const tier of tiers(quote, Math.max(0, from))) {
        const location = tier();
        if (location && (!earliest || location.start < earliest.start)) {
          earliest = location;
        }
      }
      return earliest;
    },
  };
}

export type QuoteMatchStatus = "found" | "partly_found" | "not_found";

export type QuoteSegmentMatch = {
  /** One verbatim part of the quote (the whole quote when it has no omissions). */
  text: string;
  location: QuoteLocation | null;
};

export type QuoteMatch = {
  status: QuoteMatchStatus;
  segments: QuoteSegmentMatch[];
};

export type QuoteMatchOptions = {
  /**
   * Require the parts of a quote with omissions to appear in the source in the
   * quote's order, each within `maxSegmentGapChars` of the one before. Without
   * it, each part only has to appear somewhere.
   */
  orderedSegments?: boolean;
  maxSegmentGapChars?: number;
};

/**
 * Match one quote against a prepared source:
 *   found         every part of the quote was found (in order, when required);
 *   partly_found  some parts were found but not all, or all were found but not
 *                 in order or not close enough together;
 *   not_found     no part was found, or the quote has no letters or digits.
 */
export function matchQuote(
  source: QuoteSource,
  quote: string,
  options: QuoteMatchOptions = {},
): QuoteMatch {
  const parts = splitQuoteSegments(quote);
  if (!parts.length) return { status: "not_found", segments: [] };

  const located = parts.map((text) => ({ text, location: source.locate(text) }));
  const foundCount = located.filter((segment) => segment.location).length;
  if (foundCount === 0) return { status: "not_found", segments: located };
  if (foundCount < parts.length) {
    return { status: "partly_found", segments: located };
  }
  if (parts.length === 1 || !options.orderedSegments) {
    return { status: "found", segments: located };
  }

  const chain = locateSegmentsInOrder(
    (segment, from) => source.locateFrom(segment, from),
    parts,
    options.maxSegmentGapChars ?? DEFAULT_MAX_SEGMENT_GAP_CHARS,
  );
  return chain
    ? {
        status: "found",
        segments: parts.map((text, index) => ({
          text,
          location: chain[index],
        })),
      }
    : { status: "partly_found", segments: located };
}
