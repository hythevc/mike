// SPDX-License-Identifier: AGPL-3.0-only
//
// Locate a quoted passage in extracted source text, and verify citation
// quotes against it. Chat citations use `verifyQuoteAgainstSource`; tabular
// cells match through `sourceMatcher.ts`, which shares the segment rules and
// the ordered segment search below.

import type { QuoteVerification } from "@mike/contracts";
import { normalizeWithMap } from "./normalize";

// Mirrors the frontend: cross-page quotes join two page segments with this
// sentinel (see expandDocumentQuoteEntry in
// frontend/src/app/components/shared/types.ts).
const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";
const ELLIPSIS_PATTERN = /\.{3}|…/;

// Cross-page quote fragments should straddle one page boundary, but extracted
// text may place headers, footers, or footnotes between them. Keep the bound
// deliberately generous while refusing to join passages from distant pages.
const MAX_PAGE_BREAK_SPAN_CHARS = 5_000;

// Repeated phrases require trying later occurrences when an early match cannot
// form a valid chain. Bound that search and fail closed on pathological input.
const MAX_LOCATE_ATTEMPTS = 64;

// Source-text sentinels returned by readDocumentContent when a document can't
// be read. Treat these as "no source" so every quote falls back to unverified
// rather than false-negative matching against the literal error string.
const UNREADABLE_SOURCES = new Set([
  "Document could not be read.",
  "Document not found.",
]);

export type QuoteLocation = { start: number; end: number; excerpt: string };
export type QuoteVerificationResult = QuoteVerification & {
  needs_correction: boolean;
};

/**
 * The parts of a quote that must each appear in the source. The document
 * viewers treat ASCII and Unicode ellipses as omission separators, so a quote
 * abbreviated with `...` or `…` has one segment per verbatim run. Matching the
 * viewers' normalization, punctuation-only remnants (for example, the fourth
 * dot in "....") do not form segments. A quote without letters or digits has
 * no segments.
 */
export function splitQuoteSegments(quote: string): string[] {
  return quote
    .split(ELLIPSIS_PATTERN)
    .map((segment) => segment.trim())
    .filter((segment) => /[\p{L}\p{N}]/u.test(segment));
}

/**
 * Locate `quote` inside `source`, returning the exact original substring
 * (`excerpt`) plus its char offsets into `source`. Tries progressively more
 * tolerant matchers and returns the first hit:
 *   1. exact substring
 *   2. whitespace + case normalized
 *   3. whitespace + case + punctuation normalized (tolerant/fuzzy)
 * Offsets index into the EXTRACTED source text, not the raw file bytes.
 */
export function locateQuote(
  source: string,
  quote: string,
): QuoteLocation | null {
  if (!source || !quote) return null;

  // Tier 1: exact.
  const exactIdx = source.indexOf(quote);
  if (exactIdx >= 0) {
    return { start: exactIdx, end: exactIdx + quote.length, excerpt: quote };
  }

  // Tier 2: whitespace + case. Tier 3: also punctuation-tolerant.
  return (
    locateNormalized(source, quote, {}) ??
    locateNormalized(source, quote, { stripPunctuation: true })
  );
}

/** Locate a quote at or after `from`, preserving offsets into `source`. */
function locateQuoteFrom(
  source: string,
  quote: string,
  from: number,
): QuoteLocation | null {
  if (from >= source.length) return null;
  const offset = Math.max(0, from);
  const suffix = source.slice(offset);
  const candidates: QuoteLocation[] = [];
  const exactIndex = suffix.indexOf(quote);
  if (exactIndex >= 0) {
    candidates.push({
      start: exactIndex,
      end: exactIndex + quote.length,
      excerpt: quote,
    });
  }
  const normalized = locateNormalized(suffix, quote, {});
  if (normalized) candidates.push(normalized);
  const punctuationTolerant = locateNormalized(suffix, quote, {
    stripPunctuation: true,
  });
  if (punctuationTolerant) candidates.push(punctuationTolerant);
  const location = candidates.reduce<QuoteLocation | null>(
    (earliest, candidate) =>
      !earliest || candidate.start < earliest.start ? candidate : earliest,
    null,
  );
  return location
    ? {
        start: location.start + offset,
        end: location.end + offset,
        excerpt: location.excerpt,
      }
    : null;
}

/**
 * Locate segments in document order with a bounded gap. Backtracking lets a
 * later occurrence of repeated text satisfy the complete chain. `locateFrom`
 * returns the earliest match of a segment starting at or after an offset.
 */
export function locateSegmentsInOrder(
  locateFrom: (segment: string, from: number) => QuoteLocation | null,
  segments: string[],
  maxGap: number,
): QuoteLocation[] | null {
  let attempts = 0;

  const search = (
    index: number,
    from: number,
    previousEnd: number | null,
  ): QuoteLocation[] | null => {
    if (index === segments.length) return [];

    let cursor = from;
    while (attempts < MAX_LOCATE_ATTEMPTS) {
      attempts += 1;
      const location = locateFrom(segments[index], cursor);
      if (!location) return null;
      if (previousEnd !== null && location.start - previousEnd > maxGap) {
        return null;
      }

      const remaining = search(index + 1, location.end, location.end);
      if (remaining) return [location, ...remaining];

      cursor = location.start + 1;
    }

    return null;
  };

  return search(0, 0, null);
}

function locateNormalized(
  source: string,
  quote: string,
  opts: { stripPunctuation?: boolean },
): QuoteLocation | null {
  const { norm, origIdx } = normalizeWithMap(source, opts);
  const needle = normalizeWithMap(quote, opts).norm.trim();
  if (!needle) return null;
  const pos = norm.indexOf(needle);
  if (pos < 0) return null;
  const endNormPos = pos + needle.length;
  const start = origIdx[pos] ?? 0;
  const end =
    endNormPos - 1 < origIdx.length
      ? origIdx[endNormPos - 1] + 1
      : source.length;
  return { start, end, excerpt: source.slice(start, end) };
}

/**
 * Verify a single model quote against the source text, returning the
 * per-quote verification record. Cross-page quotes and quotes abbreviated with
 * `...` or `…` are split and each segment verified independently; char offsets
 * are only attached for contiguous single-segment quotes.
 */
export function verifyQuoteAgainstSource(
  source: string,
  quote: string,
): QuoteVerificationResult {
  if (!source || UNREADABLE_SOURCES.has(source)) {
    return { verified: false, needs_correction: false };
  }

  if (quote.includes(PAGE_BREAK_SENTINEL)) {
    const segments = quote
      .split(PAGE_BREAK_SENTINEL)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!segments.length) return { verified: false, needs_correction: false };

    // Verify each segment independently (segments may contain ellipsis,
    // handled recursively by the ellipsis branch below).
    const verified = segments.map((seg) =>
      verifyQuoteAgainstSource(source, seg),
    );
    if (verified.some((result) => !result.verified)) {
      return { verified: false, needs_correction: false };
    }

    // Enforce document order and proximity across every plain-text fragment.
    // Including all ellipsis fragments makes the next page begin after the
    // preceding page segment's complete matched span, not merely its start.
    const anchorSegments = segments.flatMap((segment) => {
      const fragments = splitQuoteSegments(segment);
      return fragments.length > 0 ? fragments : [segment];
    });
    const anchors = locateSegmentsInOrder(
      (segment, from) => locateQuoteFrom(source, segment, from),
      anchorSegments,
      MAX_PAGE_BREAK_SPAN_CHARS,
    );
    if (!anchors) {
      return { verified: false, needs_correction: false };
    }

    return {
      verified: true,
      needs_correction: verified.some((result) => result.needs_correction),
      source_excerpt: verified
        .map((result, index) => result.source_excerpt ?? segments[index])
        .join(` ${PAGE_BREAK_SENTINEL} `),
    };
  }

  // The document viewers treat ASCII and Unicode ellipses as omission
  // separators and highlight each quoted segment independently. Mirror that
  // behavior here so a legitimate abbreviated quote is not rejected merely
  // because text was intentionally omitted between its verbatim segments.
  if (ELLIPSIS_PATTERN.test(quote)) {
    const segments = splitQuoteSegments(quote);
    if (!segments.length) return { verified: false, needs_correction: false };
    const located = segments.map((segment) => ({
      segment,
      location: locateQuote(source, segment),
    }));
    if (located.some(({ location }) => !location)) {
      return { verified: false, needs_correction: false };
    }
    return {
      verified: true,
      needs_correction: located.some(
        ({ segment, location }) => location!.excerpt !== segment,
      ),
      source_excerpt: located
        .map(({ location }) => location!.excerpt)
        .join(" ... "),
    };
  }

  const loc = locateQuote(source, quote);
  if (!loc) return { verified: false, needs_correction: false };
  return {
    verified: true,
    needs_correction: loc.excerpt !== quote,
    start_char: loc.start,
    end_char: loc.end,
    source_excerpt: loc.excerpt,
  };
}
