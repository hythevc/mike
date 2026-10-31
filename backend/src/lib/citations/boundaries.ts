// SPDX-License-Identifier: AGPL-3.0-only
//
// Where a quote's match may start and end in the source text. A quote found
// inside a longer word or number is a different quote: "enforceable" inside
// "unenforceable", "exclusive" inside "non-exclusive", "5 days" inside
// "15 days", "5%" inside "2.5%", "0.50%" inside "-0.50%", "500 euros" inside
// "1 500 euros". The tabular quote checks accept a match only when it starts
// and ends at the edge of a word or a number of the source.
//
// A word hyphenated at the end of a line is still one word. Extracted text
// keeps the hyphen and puts whitespace where the line ended: a line break, or,
// in text from a PDF (including an Office file converted to PDF), a space, as
// in "un- enforceable" and "non- exclusive". A hyphen left open for a later
// word ("pre- and post-closing") is followed by a linking word such as "and",
// "or" or "to", and the word after it stands on its own. In the same way a
// dash that ends a line between two numbers still makes a range ("5–" ending
// one line and "10 days" starting the next). PDF text starts each page with a
// "## Page N" heading, which is skipped when looking across a page break.
//
// Digits are checked in every script. Letters are checked only in scripts
// that put spaces between words, so a quote from Chinese, Japanese or Thai
// text still matches inside a run of text.

import { INVISIBLE_CHARACTERS } from "./normalize";

const DIGIT = /\p{Nd}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const LOWERCASE_LETTER = /\p{Ll}/u;
const WHITESPACE = /\s/;
const UNSPACED_SCRIPT =
  /[\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]/u;

/**
 * Between two digits, these continue one number: 2.5, 1,000, 1'000, and
 * 10 000 written with a no-break or thin space. An ordinary space continues a
 * number only between groups of thousands (see `spaceInsideNumber`).
 */
const NUMBER_JOINERS = new Set([
  ".",
  ",",
  "'",
  "\u2019", // right single quotation mark, a thousands separator in some locales
  "\u00A0", // no-break space
  "\u2009", // thin space
  "\u202F", // narrow no-break space
]);
/** Join the parts of a compound word or code: non-exclusive, 15-Jan, 1-A. */
const HYPHENS = new Set(["-", "\u2010", "\u2011"]);
/** Between two numbers, these make a range: 5-10, 5–10. */
const DASHES = new Set([
  "-",
  "\u2010",
  "\u2011",
  "\u2012",
  "\u2013",
  "\u2014",
  "\u2015",
  "\u2212",
]);
/** Directly before a digit, these belong to the number: -0.50, +2, ±1. */
const SIGNS = new Set(["-", "+", "\u00B1", "\u2010", "\u2011", "\u2212"]);
const SOFT_HYPHEN = "\u00AD";

/**
 * Words that follow a hyphen left open for a later word: "pre- and
 * post-closing", "short- to long-term", "pré- et post-contractuel",
 * "Ein- und Ausfuhr", "in- of uitvoer". A hyphen and whitespace before one of
 * these do not join the two halves of a word.
 */
const HYPHEN_LINK_WORDS: ReadonlySet<string> = new Set([
  // English
  "and",
  "or",
  "nor",
  "to",
  // French
  "et",
  "ou",
  // German
  "und",
  "oder",
  "bis",
  "bzw",
  "sowie",
  // Spanish, Italian, Portuguese
  "y",
  "e",
  "o",
  "u",
  "ed",
  "od",
  // Dutch
  "en",
  "of",
]);
const LONGEST_HYPHEN_LINK_WORD = Math.max(
  ...[...HYPHEN_LINK_WORDS].map((word) => word.length),
);

/** The heading PDF text gives each page, read back from its last digit. */
const PAGE_HEADING_BEFORE = /\n## Page \d{1,6}$/;
/** The same heading, read forward from its first character. */
const PAGE_HEADING_AFTER = /^## Page \d{1,6}(?=\s)/;
const PAGE_HEADING_MAX_CHARS = 16;

type Char = { ch: string; start: number; end: number };

function charAt(text: string, index: number): Char | null {
  if (index < 0 || index >= text.length) return null;
  let end = index + 1;
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && end < text.length) {
    const low = text.charCodeAt(end);
    if (low >= 0xdc00 && low <= 0xdfff) end += 1;
  }
  return { ch: text.slice(index, end), start: index, end };
}

function charBefore(text: string, index: number): Char | null {
  if (index <= 0 || index > text.length) return null;
  let start = index - 1;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff && start > 0) {
    const high = text.charCodeAt(start - 1);
    if (high >= 0xd800 && high <= 0xdbff) start -= 1;
  }
  return { ch: text.slice(start, index), start, end: index };
}

/** The first visible character at or after `index`. */
function visibleAt(text: string, index: number): Char | null {
  let char = charAt(text, index);
  while (char && INVISIBLE_CHARACTERS.has(char.ch)) {
    char = charAt(text, char.end);
  }
  return char;
}

/** The last visible character before `index`. */
function visibleBefore(text: string, index: number): Char | null {
  let char = charBefore(text, index);
  while (char && INVISIBLE_CHARACTERS.has(char.ch)) {
    char = charBefore(text, char.start);
  }
  return char;
}

/** Whitespace a reader sees: `\s` also matches the invisible U+FEFF. */
function isSpace(ch: string): boolean {
  return WHITESPACE.test(ch) && !INVISIBLE_CHARACTERS.has(ch);
}

function isDigit(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  if (code < 128) return code >= 48 && code <= 57;
  return DIGIT.test(ch);
}

/** A letter or combining mark of a script that puts spaces between words. */
function isSpacedLetter(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  if (code < 128) return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  return LETTER_OR_MARK.test(ch) && !UNSPACED_SCRIPT.test(ch);
}

function isWordCharacter(ch: string | undefined): boolean {
  return isDigit(ch) || isSpacedLetter(ch);
}

function isHyphen(ch: string): boolean {
  return HYPHENS.has(ch) || ch === SOFT_HYPHEN;
}

/** Whether the word that starts at `index` links a hyphen left open ("and"). */
function isHyphenLinkWordAt(text: string, index: number): boolean {
  let word = "";
  for (
    let char = visibleAt(text, index);
    char && isSpacedLetter(char.ch);
    char = visibleAt(text, char.end)
  ) {
    word += char.ch;
    if (word.length > LONGEST_HYPHEN_LINK_WORD) return false;
  }
  return HYPHEN_LINK_WORDS.has(word.toLowerCase());
}

/**
 * The last character of the line before `index`: the character before the
 * whitespace (and any page heading within it) that ends at `index`. Null when
 * no whitespace ends at `index`. A soft hyphen counts as a character here.
 */
function lineEndBefore(text: string, index: number): Char | null {
  let spaced = false;
  let i = index;
  for (;;) {
    const char = charBefore(text, i);
    if (!char) return null;
    if (isSpace(char.ch)) {
      spaced = true;
      i = char.start;
      continue;
    }
    if (INVISIBLE_CHARACTERS.has(char.ch) && char.ch !== SOFT_HYPHEN) {
      i = char.start;
      continue;
    }
    if (spaced && isDigit(char.ch)) {
      const heading = PAGE_HEADING_BEFORE.exec(
        text.slice(Math.max(0, i - PAGE_HEADING_MAX_CHARS), i),
      );
      if (heading) {
        // Keep the line break before the heading, to be skipped next.
        i -= heading[0].length - 1;
        continue;
      }
    }
    return spaced ? char : null;
  }
}

/**
 * The first character of the line after the whitespace (and any page heading
 * within it) that starts at `index`. Null when no whitespace starts there.
 */
function lineStartAfter(text: string, index: number): Char | null {
  let spaced = false;
  let i = index;
  for (;;) {
    const char = charAt(text, i);
    if (!char) return null;
    if (isSpace(char.ch)) {
      spaced = true;
      i = char.end;
      continue;
    }
    if (INVISIBLE_CHARACTERS.has(char.ch)) {
      i = char.end;
      continue;
    }
    if (spaced && char.ch === "#" && text[i - 1] === "\n") {
      const heading = PAGE_HEADING_AFTER.exec(
        text.slice(i, i + PAGE_HEADING_MAX_CHARS + 1),
      );
      if (heading) {
        i += heading[0].length;
        continue;
      }
    }
    return spaced ? char : null;
  }
}

/**
 * Whether `space` is an ordinary space between groups of thousands of one
 * number: one to three digits before it and exactly three after it, as in
 * "1 500" and "10 000 000". "Sections 1 2 and 13" stays three numbers.
 */
function spaceInsideNumber(text: string, space: Char): boolean {
  if (space.ch !== " ") return false;
  let before = 0;
  for (
    let char = charBefore(text, space.start);
    char && isDigit(char.ch) && before <= 3;
    char = charBefore(text, char.start)
  ) {
    before += 1;
  }
  let after = 0;
  for (
    let char = charAt(text, space.end);
    char && isDigit(char.ch) && after <= 3;
    char = charAt(text, char.end)
  ) {
    after += 1;
  }
  return before >= 1 && before <= 3 && after === 3;
}

/** Whether a match that starts at `start` begins partway through a word or number. */
export function startsInsideWord(text: string, start: number): boolean {
  const first = visibleAt(text, start);
  const before = visibleBefore(text, start);
  if (!first || !before) return false;

  if (isDigit(first.ch)) {
    // "15" for "5", "A5" for "5", "-0.50" for "0.50", "+2" for "2".
    if (isWordCharacter(before.ch) || SIGNS.has(before.ch)) return true;
    // "2.5" for "5", "1,000" for "000", "5–10" for "10".
    if (NUMBER_JOINERS.has(before.ch) || DASHES.has(before.ch)) {
      return isDigit(visibleBefore(text, before.start)?.ch);
    }
    // "1 500" for "500".
    if (spaceInsideNumber(text, before)) return true;
    // "5–" ending one line and "10" starting the next, for "10".
    const lineEnd = lineEndBefore(text, start);
    return (
      !!lineEnd &&
      DASHES.has(lineEnd.ch) &&
      isDigit(visibleBefore(text, lineEnd.start)?.ch)
    );
  }

  if (isSpacedLetter(first.ch)) {
    // "unenforceable" for "enforceable", "15days" for "days".
    if (isWordCharacter(before.ch)) return true;
    // "non-exclusive" for "exclusive".
    if (HYPHENS.has(before.ch)) {
      return isWordCharacter(visibleBefore(text, before.start)?.ch);
    }
    // "un-" ending one line and "enforceable" starting the next, for
    // "enforceable". "pre- and post-closing" for "and post-closing" is fine.
    const lineEnd = lineEndBefore(text, start);
    return (
      !!lineEnd &&
      isHyphen(lineEnd.ch) &&
      isSpacedLetter(visibleBefore(text, lineEnd.start)?.ch) &&
      !isHyphenLinkWordAt(text, first.start)
    );
  }

  // Starting on a decimal point or separator: ".5" in "2.5".
  return (
    NUMBER_JOINERS.has(first.ch) &&
    isDigit(before.ch) &&
    isDigit(visibleAt(text, first.end)?.ch)
  );
}

/** Whether a match that ends at `end` stops partway through a word or number. */
export function endsInsideWord(text: string, end: number): boolean {
  const last = visibleBefore(text, end);
  if (!last) return false;
  const after = visibleAt(text, end);

  if (isDigit(last.ch)) {
    if (!after) return false;
    // "15" for "1", "5A" for "5".
    if (isWordCharacter(after.ch)) return true;
    const next = visibleAt(text, after.end)?.ch;
    // "10.5" for "10", "1,000" for "1", "5-10" for "5".
    if ((NUMBER_JOINERS.has(after.ch) || DASHES.has(after.ch)) && isDigit(next)) {
      return true;
    }
    // "1-A" for "1".
    if (HYPHENS.has(after.ch) && isSpacedLetter(next)) return true;
    // "1 500" for "1".
    if (spaceInsideNumber(text, after)) return true;
    // "5–" ending one line and "10" starting the next, for "5".
    return DASHES.has(after.ch) && isDigit(lineStartAfter(text, after.end)?.ch);
  }

  if (isSpacedLetter(last.ch)) {
    // "agreed" for "agree", "Guarantors" for "Guarantor".
    if (after && isWordCharacter(after.ch)) return true;
    // "Company-wide" for "Company".
    if (
      after &&
      HYPHENS.has(after.ch) &&
      isWordCharacter(visibleAt(text, after.end)?.ch)
    ) {
      return true;
    }
    // "enforce-" ending one line and "able" starting the next, for
    // "enforce". "pre- and post-closing" for "pre" is fine.
    let hyphen = charAt(text, end);
    while (
      hyphen &&
      INVISIBLE_CHARACTERS.has(hyphen.ch) &&
      hyphen.ch !== SOFT_HYPHEN
    ) {
      hyphen = charAt(text, hyphen.end);
    }
    if (!hyphen || !isHyphen(hyphen.ch)) return false;
    const next = lineStartAfter(text, hyphen.end);
    return (
      !!next &&
      LOWERCASE_LETTER.test(next.ch) &&
      isSpacedLetter(next.ch) &&
      !isHyphenLinkWordAt(text, next.start)
    );
  }

  // Ending on a decimal point or separator: "1." in "1.2".
  return (
    !!after &&
    NUMBER_JOINERS.has(last.ch) &&
    isDigit(after.ch) &&
    isDigit(visibleBefore(text, last.start)?.ch)
  );
}

/** Whether the match `[start, end)` cuts into a word or number at either edge. */
export function cutsIntoWord(text: string, start: number, end: number): boolean {
  return startsInsideWord(text, start) || endsInsideWord(text, end);
}
