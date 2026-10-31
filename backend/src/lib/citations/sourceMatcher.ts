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
//   3. tolerant: whitespace and punctuation ignored too, except the
//      characters that change what a number says. Only for quotes long enough
//      that ignoring that much cannot produce an accidental match.
// In every tier a match must start and end at the edge of a word or a number
// of the source (see `boundaries.ts`), so "5 days" is not found in "15 days".
// Offsets always index into the original source text, and `excerpt` is the
// exact source text that matched.

import { cutsIntoWord } from "./boundaries";
import { foldWithMap, type FoldedText } from "./normalize";
import type { QuoteLocation } from "./quoteMatch";

/**
 * The tolerant tier ignores whitespace and most punctuation, so a quote has to
 * keep this many letters and digits for a tolerant match to mean anything.
 * Shorter quotes ("(i)", "§ 5", "Yes") match only exactly or folded.
 */
const MIN_TOLERANT_ALPHANUMERICS = 8;

/**
 * Omissions in a quote stand for words left out of one passage. When the
 * parts of a quote have to be found in order, each part must start within
 * this many characters of the previous part's end, so text stitched together
 * from distant clauses is not reported as found.
 */
export const DEFAULT_MAX_SEGMENT_GAP_CHARS = 2_000;

/**
 * A ceiling on the work of one ordered search. The search is linear in the
 * occurrences of a quote's parts; only adversarial input comes near this.
 */
const MAX_ORDERED_SEARCH_STEPS = 10_000;

// An omission marker: an ellipsis ("...", "…" or the spaced ". . ."), alone or
// in square or round brackets ("[...]", "[…]", "(...)").
const OMISSION =
  /[[(][ \t\u00A0]*(?:\.(?:[ \t\u00A0]*\.){2,}|\u2026)[ \t\u00A0]*[\])]|\.(?:[ \t\u00A0]*\.){2,}|\u2026/u;

/**
 * The verbatim parts of a quote, split at its omission markers. Parts without
 * letters or digits (the fourth dot of "....", a stray bracket) are dropped;
 * a quote without letters or digits has no parts.
 */
export function splitQuoteParts(quote: string): string[] {
  return quote
    .split(OMISSION)
    .map((part) => part.replace(/^[\s\])]+/u, "").replace(/[\s[(]+$/u, ""))
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

export type QuoteSource = {
  readonly text: string;
  /** First match of `quote`: an exact match, else a folded one, else a tolerant one. */
  locate(quote: string): QuoteLocation | null;
  /**
   * The earliest match of `quote`, in any tier, that starts at or after
   * `from` and ends at or after `minEnd`.
   */
  locateFrom(quote: string, from: number, minEnd?: number): QuoteLocation | null;
};

/** Index of the first normalized character that maps to `from` or later. */
function firstAtOrAfter(origIdx: Uint32Array, from: number): number {
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

type Needles = { folded: string; tolerant: string };

export function prepareQuoteSource(text: string): QuoteSource {
  let folded: FoldedText | null = null;
  let tolerant: FoldedText | null = null;
  const foldedText = () => (folded ??= foldWithMap(text));
  const tolerantText = () =>
    (tolerant ??= foldWithMap(text, { tolerant: true }));

  const needles = new Map<string, Needles>();
  const needlesOf = (quote: string): Needles => {
    let entry = needles.get(quote);
    if (!entry) {
      entry = {
        folded: foldWithMap(quote).norm.trim(),
        tolerant:
          countAlphanumerics(quote) >= MIN_TOLERANT_ALPHANUMERICS
            ? foldWithMap(quote, { tolerant: true }).norm
            : "",
      };
      needles.set(quote, entry);
    }
    return entry;
  };

  // The last answer per tier and needle. The ordered search asks again with
  // bounds that only grow, so an answer at or after the new bound still holds
  // and the text before it is not searched twice.
  const answers = new Map<string, { bound: number; found: number }>();
  const firstAccepted = (
    key: string,
    bound: number,
    search: (from: number) => number,
  ): number => {
    const last = answers.get(key);
    if (last && bound >= last.bound && (last.found < 0 || bound <= last.found)) {
      return last.found;
    }
    const found = search(bound);
    answers.set(key, { bound, found });
    return found;
  };

  const exactMatch = (
    quote: string,
    from: number,
    minEnd: number,
  ): QuoteLocation | null => {
    const bound = Math.max(0, from, minEnd - quote.length);
    const found = firstAccepted(`exact\u0000${quote}`, bound, (start) => {
      for (
        let at = text.indexOf(quote, start);
        at >= 0;
        at = text.indexOf(quote, at + 1)
      ) {
        if (!cutsIntoWord(text, at, at + quote.length)) return at;
      }
      return -1;
    });
    return found < 0
      ? null
      : { start: found, end: found + quote.length, excerpt: quote };
  };

  const normalizedMatch = (
    tier: string,
    index: FoldedText,
    needle: string,
    from: number,
    minEnd: number,
  ): QuoteLocation | null => {
    if (!needle) return null;
    const { norm, origIdx } = index;
    let bound = firstAtOrAfter(origIdx, from);
    if (minEnd > 0) {
      bound = Math.max(
        bound,
        firstAtOrAfter(origIdx, minEnd - 1) - needle.length + 1,
      );
    }
    const found = firstAccepted(`${tier}\u0000${needle}`, bound, (start) => {
      for (
        let at = norm.indexOf(needle, start);
        at >= 0;
        at = norm.indexOf(needle, at + 1)
      ) {
        const last = at + needle.length - 1;
        // Starting or ending partway through one source character (a
        // ligature's letters) cuts into a word.
        if (at > 0 && origIdx[at - 1] === origIdx[at]) continue;
        if (last + 1 < origIdx.length && origIdx[last + 1] === origIdx[last]) {
          continue;
        }
        if (!cutsIntoWord(text, origIdx[at], origIdx[last] + 1)) return at;
      }
      return -1;
    });
    if (found < 0) return null;
    const start = origIdx[found];
    const end = origIdx[found + needle.length - 1] + 1;
    return { start, end, excerpt: text.slice(start, end) };
  };

  const tiers = (quote: string) => {
    const needle = needlesOf(quote);
    return [
      (from: number, minEnd: number) => exactMatch(quote, from, minEnd),
      (from: number, minEnd: number) =>
        normalizedMatch("folded", foldedText(), needle.folded, from, minEnd),
      (from: number, minEnd: number) =>
        needle.tolerant
          ? normalizedMatch(
              "tolerant",
              tolerantText(),
              needle.tolerant,
              from,
              minEnd,
            )
          : null,
    ];
  };

  return {
    text,
    locate(quote) {
      if (!text || !quote) return null;
      for (const tier of tiers(quote)) {
        const location = tier(0, 0);
        if (location) return location;
      }
      return null;
    },
    locateFrom(quote, from, minEnd = 0) {
      if (!text || !quote || from >= text.length) return null;
      let earliest: QuoteLocation | null = null;
      for (const tier of tiers(quote)) {
        const location = tier(Math.max(0, from), minEnd);
        if (location && (!earliest || location.start < earliest.start)) {
          earliest = location;
        }
      }
      return earliest;
    },
  };
}

/**
 * Find `parts` in order: each starts at or after the end of the one before
 * and within `maxGap` characters of it. Returns the earliest such chain, or
 * null when there is none.
 *
 * The search never tries an occurrence that cannot work. When the next part
 * first appears too far after the current part, every chain needs a later
 * occurrence of the current part, one ending within `maxGap` of that next
 * occurrence, so the search moves straight there. Each part's search bounds
 * only grow, which keeps the work linear in the parts' occurrences however
 * often a phrase repeats in a long document.
 */
export function locatePartsInOrder(
  source: QuoteSource,
  parts: string[],
  maxGap: number,
): QuoteLocation[] | null {
  const chain: QuoteLocation[] = [];
  const minStart = parts.map(() => 0);
  const minEnd = parts.map(() => 0);
  let index = 0;
  for (let step = 0; index < parts.length; step += 1) {
    if (step >= MAX_ORDERED_SEARCH_STEPS) return null;
    const location = source.locateFrom(
      parts[index],
      minStart[index],
      minEnd[index],
    );
    if (!location) return null;
    const previous = chain[index - 1];
    if (previous && location.start - previous.end > maxGap) {
      // After any later occurrence of the previous part, this part still
      // starts no earlier than `location`, so the previous part must end
      // within `maxGap` of it.
      minEnd[index - 1] = location.start - maxGap;
      minStart[index] = location.start;
      index -= 1;
      chain.length = index;
      continue;
    }
    chain[index] = location;
    index += 1;
    if (index < parts.length) {
      minStart[index] = Math.max(minStart[index], location.end);
    }
  }
  return chain;
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
 * Match one quote against a prepared source. The quote's parts are split at
 * omission markers ("...", "…", ". . .", "[...]", "(…)"):
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
  const parts = splitQuoteParts(quote);
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

  const chain = locatePartsInOrder(
    source,
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
