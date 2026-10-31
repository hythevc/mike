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
// joiners, byte order marks) that are dropped.
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
  "\uFEFF": "", // zero width no-break space (byte order mark)
};

/**
 * Characters no reader sees. Folding drops them, and they never separate
 * two words or two digits.
 */
export const INVISIBLE_CHARACTERS: ReadonlySet<string> = new Set(
  Object.keys(FOLDED).filter((ch) => FOLDED[ch] === ""),
);

export type FoldedText = {
  norm: string;
  /** For each character of `norm`, the index of the source character it came from. */
  origIdx: Uint32Array;
};

// What folding needs to know about a UTF-16 code unit, as bit flags. Each code
// unit is classified by regular expression the first time it is seen and read
// back from `CLASSES` after that, so folding a long source runs no regular
// expression per character, whatever its script.
const CLASSIFIED = 1;
/** Whitespace as `\s` matches it, except the invisible U+FEFF. */
const SPACE = 1 << 1;
/** A character no reader sees: folding drops it (see `FOLDED`). */
const INVISIBLE = 1 << 2;
/** A typographic variant that folding writes another way (see `FOLDED`). */
const FOLDS = 1 << 3;
/** A decimal digit, in any script. */
const DIGIT = 1 << 4;
/** A letter, a combining mark or a number. */
const ALPHANUMERIC = 1 << 5;
/** Neither a letter, a number nor whitespace (see `isPunctuation`). */
const PUNCTUATION = 1 << 6;
const CURRENCY = 1 << 7;
const MATH = 1 << 8;
/** Lowercases to more than one code unit (U+0130). */
const LOWERCASE_EXPANDS = 1 << 9;

const CLASSES = new Uint16Array(0x10000);
/** The lowercase of each classified code unit that lowercases to one unit. */
const LOWERCASE = new Uint16Array(0x10000);

function classify(code: number): number {
  const ch = String.fromCharCode(code);
  let flags = CLASSIFIED;
  if (Object.prototype.hasOwnProperty.call(FOLDED, ch)) {
    flags |= FOLDED[ch] === "" ? INVISIBLE : FOLDS;
  }
  if (/\s/.test(ch) && !(flags & INVISIBLE)) flags |= SPACE;
  if (/\p{Nd}/u.test(ch)) flags |= DIGIT;
  if (/[\p{L}\p{M}\p{N}]/u.test(ch)) flags |= ALPHANUMERIC;
  if (isPunctuation(ch)) flags |= PUNCTUATION;
  if (/\p{Sc}/u.test(ch)) flags |= CURRENCY;
  if (/\p{Sm}/u.test(ch)) flags |= MATH;
  const lower = ch.toLowerCase();
  if (lower.length === 1) LOWERCASE[code] = lower.charCodeAt(0);
  else flags |= LOWERCASE_EXPANDS;
  return flags;
}

function classOf(code: number): number {
  let flags = CLASSES[code];
  if (flags === 0) {
    flags = classify(code);
    CLASSES[code] = flags;
  }
  return flags;
}

function isAsciiAlphanumeric(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/** Whether code unit `code` (-1 for none) is a decimal digit. */
function isDigitCode(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return code >= 48 && code <= 57;
  return (classOf(code) & DIGIT) !== 0;
}

/** Percent signs and every currency symbol: "10%" and "€10" are not "10". */
function isUnitSymbol(code: number): boolean {
  return (
    code === 37 || // percent sign
    code === 0x2030 || // per mille
    code === 0x2031 || // per ten thousand
    (classOf(code) & CURRENCY) !== 0
  );
}

// Minus and hyphen characters that are a sign when they stand directly before
// a digit ("-0.50%"). En and em dashes are punctuation even there.
const SIGN_CHARACTERS = new Set([0x2d, 0x2010, 0x2011, 0x2212]);

// ASCII operators that also appear as markup ("<br>", "> quoted line"): they
// count only when a number follows them. Plus, less-than, equals, greater-than.
const ASCII_OPERATORS = new Set([0x2b, 0x3c, 0x3d, 0x3e]);

function numberFollows(text: string, from: number): boolean {
  for (let i = from; i < text.length; i++) {
    const flags = classOf(text.charCodeAt(i));
    if (flags & (SPACE | INVISIBLE)) continue;
    return (flags & (DIGIT | CURRENCY)) !== 0;
  }
  return false;
}

/**
 * Whether the tolerant form keeps the punctuation at `text[i]`, which folds to
 * code unit `folded`. It keeps what can change the meaning of a number: a
 * separator between two digits ("1,000.50", "5-10"), a sign directly before a
 * digit ("-0.50"), percent and currency symbols, comparison and arithmetic
 * symbols ("≥ 3.50"), and an ASCII operator a number follows ("> 50%").
 */
function keptWhenTolerant(text: string, i: number, folded: number): boolean {
  const before = i > 0 ? text.charCodeAt(i - 1) : -1;
  const after = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
  if (isDigitCode(before) && isDigitCode(after)) return true;
  if (isUnitSymbol(folded)) return true;
  if (
    SIGN_CHARACTERS.has(text.charCodeAt(i)) &&
    isDigitCode(after) &&
    !(before >= 0 && (classOf(before) & ALPHANUMERIC) !== 0)
  ) {
    return true;
  }
  if (ASCII_OPERATORS.has(folded)) return numberFollows(text, i + 1);
  return folded > 127 && (classOf(folded) & MATH) !== 0;
}

/** Growable buffer of UTF-16 code units, each with the source index it came from. */
class FoldBuffer {
  private codes: Uint16Array;
  private indexes: Uint32Array;
  length = 0;

  constructor(capacity: number) {
    this.codes = new Uint16Array(Math.max(16, capacity));
    this.indexes = new Uint32Array(Math.max(16, capacity));
  }

  push(code: number, sourceIndex: number): void {
    if (this.length === this.codes.length) {
      const codes = new Uint16Array(this.codes.length * 2);
      codes.set(this.codes);
      this.codes = codes;
      const indexes = new Uint32Array(this.indexes.length * 2);
      indexes.set(this.indexes);
      this.indexes = indexes;
    }
    this.codes[this.length] = code;
    this.indexes[this.length] = sourceIndex;
    this.length += 1;
  }

  lastCode(): number {
    return this.length ? this.codes[this.length - 1] : -1;
  }

  finish(): FoldedText {
    return {
      norm: UTF16.decode(this.codes.subarray(0, this.length)),
      origIdx: this.indexes.slice(0, this.length),
    };
  }
}

// One code unit in, one code unit out: an unpaired surrogate decodes to
// U+FFFD, so `norm` stays as long as `origIdx`. A leading U+FEFF is kept.
const UTF16 = new TextDecoder("utf-16le", { ignoreBOM: true });

/**
 * The normalization the tabular quote checks match with. It is stricter about
 * numbers and more forgiving about typography than `normalizeWithMap`.
 *
 * Base form: whitespace collapsed to one space, lowercased, typographic
 * variants folded (curly quotes to straight ones, the dash family to "-",
 * ligatures to their letters) and invisible characters dropped, so a quote
 * that differs from the extracted text only in those respects still matches.
 *
 * Tolerant form (`tolerant: true`): also drops whitespace and the punctuation
 * that cannot change what a number says (see `keptWhenTolerant`). A stray
 * comma, a line-break hyphen or a missing space then no longer prevents a
 * match, while "1,000.50", "-0.50%", "€10" and "≤ 3.50" keep the characters
 * that make them what they are. Where whitespace or dropped punctuation stood
 * between two digits, a single space stays, so "1, 2" never reads as "12".
 *
 * Each output character maps back to the original character it came from; a
 * ligature that expands to two letters maps both to the same index. The work
 * is linear in the length of `text`, in any script.
 */
export function foldWithMap(
  text: string,
  opts: { tolerant?: boolean } = {},
): FoldedText {
  const tolerant = opts.tolerant ?? false;
  const out = new FoldBuffer(text.length);
  let prevSpace = false;
  // Tolerant form: where whitespace or punctuation was dropped since the last
  // character kept, if any was.
  let droppedAt = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128 && isAsciiAlphanumeric(code)) {
      // The common case, without a table lookup.
      if (tolerant && droppedAt >= 0 && code <= 57 && isDigitCode(out.lastCode())) {
        out.push(32, droppedAt);
      }
      out.push(code >= 65 && code <= 90 ? code + 32 : code, i);
      droppedAt = -1;
      prevSpace = false;
      continue;
    }
    const flags = classOf(code);
    if (flags & INVISIBLE) continue;
    if (flags & SPACE) {
      if (tolerant) {
        if (droppedAt < 0) droppedAt = i;
      } else if (!prevSpace) {
        out.push(32, i);
        prevSpace = true;
      }
      continue;
    }
    if (flags & FOLDS) {
      // A typographic variant folds to ASCII: one punctuation mark, or the
      // letters of a ligature, none of them a digit.
      const folded = FOLDED[text[i]];
      const mark = folded.charCodeAt(0);
      if (
        tolerant &&
        folded.length === 1 &&
        !isAsciiAlphanumeric(mark) &&
        !keptWhenTolerant(text, i, mark)
      ) {
        if (droppedAt < 0) droppedAt = i;
        continue;
      }
      for (let k = 0; k < folded.length; k++) {
        const unit = folded.charCodeAt(k);
        out.push(unit >= 65 && unit <= 90 ? unit + 32 : unit, i);
      }
      droppedAt = -1;
      prevSpace = false;
      continue;
    }
    if (tolerant && (flags & PUNCTUATION) !== 0 && !keptWhenTolerant(text, i, code)) {
      if (droppedAt < 0) droppedAt = i;
      continue;
    }
    if (flags & LOWERCASE_EXPANDS) {
      const lowered = text[i].toLowerCase();
      for (let k = 0; k < lowered.length; k++) {
        out.push(lowered.charCodeAt(k), i);
      }
    } else {
      if (
        tolerant &&
        droppedAt >= 0 &&
        (flags & DIGIT) !== 0 &&
        isDigitCode(out.lastCode())
      ) {
        out.push(32, droppedAt);
      }
      out.push(LOWERCASE[code], i);
    }
    droppedAt = -1;
    prevSpace = false;
  }
  return out.finish();
}
