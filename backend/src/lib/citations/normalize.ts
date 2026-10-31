// SPDX-License-Identifier: AGPL-3.0-only
//
// Text normalization for quote matching. Each normalizer returns the
// normalized text plus a map from every normalized character back to the index
// of the original character it came from, so a match found in the normalized
// form can be returned as the exact original text.

export type NormalizedText = { norm: string; origIdx: number[] };

/** A character is "punctuation" for tolerant matching if it is not a letter,
 *  number, or whitespace. Dropped entirely (not replaced with a space) so
 *  "U.S." collapses to "us" and "plaintiff's" to "plaintiffs". */
function isPunctuation(ch: string): boolean {
  return !/[\p{L}\p{N}\s]/u.test(ch);
}

/**
 * Build a whitespace-collapsed, lowercased copy of `text`, plus a map from
 * each character index in the normalized form back to the corresponding
 * index in the original text. Used by `findInDocumentContent` (and server-side
 * citation verification) so matches are tolerant of case + whitespace variance
 * but can still return the exact original excerpt.
 *
 * With `stripPunctuation`, punctuation characters are removed from the
 * normalized form too, making matching tolerant of punctuation drift (e.g. a
 * model that adds a stray comma or drops a period). The index map still points
 * back at the surviving original characters so the recovered excerpt is exact.
 */
export function normalizeWithMap(
  text: string,
  opts: { stripPunctuation?: boolean } = {},
): NormalizedText {
  const stripPunctuation = opts.stripPunctuation ?? false;
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(" ");
        origIdx.push(i);
        prevSpace = true;
      }
    } else if (stripPunctuation && isPunctuation(ch)) {
      // Drop punctuation without disturbing the space-collapsing state so
      // "foo, bar" -> "foo bar" but "U.S." -> "us".
      continue;
    } else {
      norm.push(ch.toLowerCase());
      origIdx.push(i);
      prevSpace = false;
    }
  }
  return { norm: norm.join(""), origIdx };
}

// Typographic variants that text extraction and models write differently:
// curly and straight quotes, the dash family, the ligatures PDF text layers
// often carry, and invisible characters (soft hyphens, zero-width spaces and
// joiners) that are dropped.
const FOLDED: Readonly<Record<string, string>> = {
  "\u2018": "'", // left single quotation mark
  "\u2019": "'", // right single quotation mark
  "\u201A": "'", // single low-9 quotation mark
  "\u201B": "'", // single high-reversed-9 quotation mark
  "\u2032": "'", // prime
  "\u02BC": "'", // modifier letter apostrophe
  "\u201C": '"', // left double quotation mark
  "\u201D": '"', // right double quotation mark
  "\u201E": '"', // double low-9 quotation mark
  "\u201F": '"', // double high-reversed-9 quotation mark
  "\u2033": '"', // double prime
  "\u00AB": '"', // left-pointing double angle quotation mark
  "\u00BB": '"', // right-pointing double angle quotation mark
  "\u2010": "-", // hyphen
  "\u2011": "-", // non-breaking hyphen
  "\u2012": "-", // figure dash
  "\u2013": "-", // en dash
  "\u2014": "-", // em dash
  "\u2015": "-", // horizontal bar
  "\u2212": "-", // minus sign
  "\uFB00": "ff", // latin small ligature ff
  "\uFB01": "fi", // latin small ligature fi
  "\uFB02": "fl", // latin small ligature fl
  "\uFB03": "ffi", // latin small ligature ffi
  "\uFB04": "ffl", // latin small ligature ffl
  "\uFB05": "st", // latin small ligature long s t
  "\uFB06": "st", // latin small ligature st
  "\u00AD": "", // soft hyphen
  "\u200B": "", // zero width space
  "\u200C": "", // zero width non-joiner
  "\u200D": "", // zero width joiner
  "\u2060": "", // word joiner
};

function isWhitespace(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code === 32 || (code >= 9 && code <= 13)) return true;
  return code > 127 && /\s/.test(ch);
}

function isAsciiAlphanumeric(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isFoldedPunctuation(folded: string): boolean {
  const code = folded.charCodeAt(0);
  if (folded.length === 1 && code < 128) return !isAsciiAlphanumeric(code);
  return isPunctuation(folded);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && /\p{Nd}/u.test(ch);
}

/**
 * The normalization the tabular quote checks match with. It is stricter about
 * numbers and more forgiving about typography than `normalizeWithMap`.
 *
 * Base form: whitespace collapsed to one space, lowercased, typographic
 * variants folded (curly quotes to straight ones, the dash family to "-",
 * ligatures to their letters) and invisible characters dropped, so a quote
 * that differs from the extracted text only in those respects still matches.
 *
 * Tolerant form (`tolerant: true`): also drops all whitespace and every
 * punctuation character except one between two digits. A stray comma, a
 * line-break hyphen or a missing space then no longer prevents a match, while
 * "1,000.50" keeps its separators: amounts and clause numbers that differ
 * only in punctuation ("$10,000.00" and "$1,000,000") never match each other.
 *
 * Each output character maps back to the original character it came from; a
 * ligature that expands to two letters maps both to the same index.
 */
export function foldWithMap(
  text: string,
  opts: { tolerant?: boolean } = {},
): NormalizedText {
  const tolerant = opts.tolerant ?? false;
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isWhitespace(ch)) {
      if (!tolerant && !prevSpace) {
        norm.push(" ");
        origIdx.push(i);
        prevSpace = true;
      }
      continue;
    }
    const folded = FOLDED[ch] ?? ch;
    if (!folded) continue;
    if (
      tolerant &&
      isFoldedPunctuation(folded) &&
      !(isDigit(text[i - 1]) && isDigit(text[i + 1]))
    ) {
      continue;
    }
    const lowered = folded.toLowerCase();
    for (let k = 0; k < lowered.length; k++) {
      norm.push(lowered[k]);
      origIdx.push(i);
    }
    prevSpace = false;
  }
  return { norm: norm.join(""), origIdx };
}
