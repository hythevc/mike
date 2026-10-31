// SPDX-License-Identifier: AGPL-3.0-only
//
// Where a quote's match may start and end in the source text. A quote found
// inside a longer word or number is a different quote: "enforceable" inside
// "unenforceable", "exclusive" inside "non-exclusive", "5 days" inside
// "15 days", "5%" inside "2.5%", "0.50%" inside "-0.50%". The tabular quote
// checks accept a match only when it starts and ends at the edge of a word or
// a number of the source.
//
// Digits are checked in every script. Letters are checked only in scripts
// that put spaces between words, so a quote from Chinese, Japanese or Thai
// text still matches inside a run of text.

import { INVISIBLE_CHARACTERS } from "./normalize";

const DIGIT = /\p{Nd}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const LOWERCASE_LETTER = /\p{Ll}/u;
const WHITESPACE = /\s/;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
const UNSPACED_SCRIPT =
  /[\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]/u;

/** Between two digits, these continue one number: 2.5, 1,000, 1'000, 10 000. */
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

/**
 * At `index` a hyphen (or soft hyphen) ends a line and the word goes on, in
 * lower case, on the next one: "un-\nenforceable".
 */
function hyphenatedAcrossLineAt(text: string, index: number): boolean {
  const hyphen = text[index];
  if (!(HYPHENS.has(hyphen) || hyphen === SOFT_HYPHEN)) return false;
  let i = index + 1;
  let lineBreak = false;
  while (i < text.length && WHITESPACE.test(text[i])) {
    if (LINE_BREAK.test(text[i])) lineBreak = true;
    i += 1;
  }
  const next = visibleAt(text, i);
  return lineBreak && !!next && LOWERCASE_LETTER.test(next.ch);
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
    return false;
  }

  if (isSpacedLetter(first.ch)) {
    // "unenforceable" for "enforceable", "15days" for "days".
    if (isWordCharacter(before.ch)) return true;
    // "non-exclusive" for "exclusive".
    if (HYPHENS.has(before.ch)) {
      return isWordCharacter(visibleBefore(text, before.start)?.ch);
    }
    // "un-\nenforceable" for "enforceable".
    let i = start;
    while (i > 0 && WHITESPACE.test(text[i - 1])) i -= 1;
    return (
      i < start &&
      i > 0 &&
      hyphenatedAcrossLineAt(text, i - 1) &&
      isSpacedLetter(visibleBefore(text, i - 1)?.ch)
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
    return HYPHENS.has(after.ch) && isSpacedLetter(next);
  }

  if (isSpacedLetter(last.ch)) {
    // "agreed" for "agree", "Guarantors" for "Guarantor".
    if (after && isWordCharacter(after.ch)) return true;
    // "Company-wide" for "Company".
    if (after && HYPHENS.has(after.ch)) {
      if (isWordCharacter(visibleAt(text, after.end)?.ch)) return true;
      if (hyphenatedAcrossLineAt(text, after.start)) return true;
    }
    // "enforce-\nable" for "enforce".
    return hyphenatedAcrossLineAt(text, end);
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
