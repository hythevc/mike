// SPDX-License-Identifier: AGPL-3.0-only
//
// Quote checks for tabular review cells.
//
// A cell's answer cites its sources inline, in its summary and its reasoning:
// [[document:ID||page:N||quote:...]], or sheet and cell for spreadsheets. When
// a cell is finalized, each quote is matched against the text extracted from
// the source document it cites: the same text the model read for that row,
// still in memory from the extraction. The cell records what was checked:
//
//   found         every quote was found in its cited source's text;
//   partly_found  some quoted text was found and some was not, or the parts of
//                 a quote with omissions ("..." or "…") were not found
//                 together and in order;
//   not_found     no quote was found;
//   no_quote      the answer carries no quote;
//   no_text       a source of the row yielded no extractable text (a scanned,
//                 encrypted or damaged file), so the row was not answered and
//                 no "Not Found" answer is recorded for it.
//
// Only the quoted text is matched. The page, sheet or cell a citation names is
// not checked, and a found quote does not mean the answer is right. Each cell
// also records which version of each source it read, so it can report later
// that a source has changed since (`stale`).

import type {
    TabularCellQuoteFields,
    TabularCellStaleness,
    TabularQuoteCheck,
    TabularQuoteMatchStatus,
    TabularQuoteStatus,
    TabularQuoteSummary,
} from "@mike/contracts";
import { AppError } from "../../lib/appError";
import {
    matchQuote,
    prepareQuoteSource,
    type QuoteMatch,
    type QuoteSource,
} from "../../lib/citations/sourceMatcher";
import { reportError } from "../../lib/observability/sentry";
import type { RowDocumentText } from "./tabular.rows";
import type { CellResult } from "./tabular.shared";

/** Parts of a quote with omissions must be found in the quote's order. */
const CELL_QUOTE_MATCH = { orderedSegments: true } as const;
/** Source text kept on each side of a match, for showing the quote in place. */
const CONTEXT_CHARS = 160;
const MAX_STORED_QUOTE_CHARS = 1_000;
const MAX_STORED_EXCERPT_CHARS = 1_000;
const MAX_DOCUMENT_REFERENCE_CHARS = 200;

/**
 * The answer stored for every cell of a row with a source that has no
 * extractable text: no answer at all, so nothing reads as a "Not Found" that
 * was looked for and not there.
 */
export const NO_TEXT_RESULT: CellResult = {
    summary: "",
    flag: "grey",
    reasoning: "",
};

/** What the review chat reads for such a cell, in place of an empty answer. */
export const NO_TEXT_CELL_NOTE =
    "Not answered: a source document for this row has no extractable text (for example, a scanned file without a text layer), so it was not reviewed.";

// ---------------------------------------------------------------------------
// Citations in a cell
// ---------------------------------------------------------------------------

const INLINE_MARKER = /\[\[((?:[^\[\]]|\[[^\]]*\])+)\]\]/g;

export type CellCitation = {
    field: "summary" | "reasoning";
    documentId?: string;
    page?: number;
    sheet?: string;
    cell?: string;
    quote: string;
};

function parsePageCitation(
    metadata: string,
): Omit<CellCitation, "field"> | null {
    const match = metadata.match(
        /^(?:document:([^|]+)\|\|)?page:(\d+)\|\|(?:quote:)?([\s\S]+)$/i,
    );
    if (!match) return null;
    return {
        documentId: match[1]?.trim() || undefined,
        page: parseInt(match[2], 10),
        quote: match[3].trim(),
    };
}

function parseSpreadsheetCitation(
    metadata: string,
): Omit<CellCitation, "field"> | null {
    const quoteSeparator = metadata.search(/\|\|quote:/i);
    if (quoteSeparator < 0) return null;
    const quote = metadata
        .slice(quoteSeparator)
        .replace(/^\|\|quote:/i, "")
        .trim();
    if (!quote) return null;

    const fields = new Map<string, string>();
    for (const part of metadata.slice(0, quoteSeparator).split("||")) {
        const separator = part.indexOf(":");
        if (separator < 0) continue;
        const key = part.slice(0, separator).trim().toLowerCase();
        const value = part.slice(separator + 1).trim();
        if (value) fields.set(key, value);
    }
    const sheet = fields.get("sheet");
    const row = fields.get("row");
    const column = fields.get("col") ?? fields.get("column");
    const cell =
        fields.get("cell") ?? (column && row ? `${column}${row}` : undefined);
    if (!sheet || !cell) return null;
    return { documentId: fields.get("document"), sheet, cell, quote };
}

/**
 * The citations in a cell's summary and reasoning, parsed the way the review
 * grid parses them (frontend/src/app/components/tabular/citation-utils.ts), so
 * the quotes checked are the quotes a reviewer sees. Markers that are not
 * citations, such as [[Yes]] or [[USD]], are skipped, and so are citations
 * whose quote has no letters or digits to match.
 */
export function parseCellCitations(result: {
    summary?: unknown;
    reasoning?: unknown;
}): CellCitation[] {
    const citations: CellCitation[] = [];
    for (const field of ["summary", "reasoning"] as const) {
        const text = result[field];
        if (typeof text !== "string" || !text) continue;
        for (const marker of text.matchAll(INLINE_MARKER)) {
            const citation =
                parsePageCitation(marker[1]) ??
                parseSpreadsheetCitation(marker[1]);
            if (citation && /[\p{L}\p{N}]/u.test(citation.quote)) {
                citations.push({ field, ...citation });
            }
        }
    }
    return citations;
}

// ---------------------------------------------------------------------------
// Checking a cell
// ---------------------------------------------------------------------------

/** Stored per source: the text the cell's answer was drawn from. */
export type SourceVersionRecord = {
    version_id: string | null;
    content_sha256: string | null;
    has_text: boolean;
};

/** The quote-check columns written together with a cell's answer. */
export type CellQuoteCheck = {
    quote_status: TabularQuoteStatus;
    quote_checks: TabularQuoteCheck[];
    source_versions: Record<string, SourceVersionRecord>;
};

/**
 * Written whenever a cell's answer is cleared, so no check outlives it, and
 * with an answer whose check failed.
 */
export const CLEARED_QUOTE_CHECK = {
    quote_status: null,
    quote_checks: null,
    source_versions: null,
} as const;

export function sourceVersionsOf(
    text: RowDocumentText,
): Record<string, SourceVersionRecord> {
    return Object.fromEntries(
        text.sources.map((source) => [
            source.documentId,
            {
                version_id: source.versionId,
                content_sha256: source.contentSha256,
                has_text: source.markdown.trim().length > 0,
            },
        ]),
    );
}

/**
 * A row can only be answered from all of its sources. One that has none, or
 * has a source that yielded no text, is not answered at all: an answer drawn
 * from part of a folder could miss what the unreadable file says.
 */
export function rowHasNoText(text: RowDocumentText): boolean {
    return (
        text.sources.length === 0 ||
        text.sources.some((source) => !source.markdown.trim())
    );
}

export function noTextQuoteCheck(text: RowDocumentText): CellQuoteCheck {
    return {
        quote_status: "no_text",
        quote_checks: [],
        source_versions: sourceVersionsOf(text),
    };
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const normalizeId = (id: string) => id.trim().toLowerCase();

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

function contextBefore(text: string, start: number): string {
    const from = Math.max(0, start - CONTEXT_CHARS);
    let context = text.slice(from, start);
    // Drop a word the window cut in half.
    if (!isSpace(text[from - 1])) context = context.replace(/^\S*\s/, "");
    return context.replace(/\s+/g, " ").trimStart();
}

function contextAfter(text: string, end: number): string {
    const to = Math.min(text.length, end + CONTEXT_CHARS);
    let context = text.slice(end, to);
    if (!isSpace(text[to])) context = context.replace(/\s\S*$/, "");
    return context.replace(/\s+/g, " ").trimEnd();
}

function toQuoteCheck(
    citation: CellCitation,
    documentId: string | null,
    match: QuoteMatch,
    sourceText: string | null,
): TabularQuoteCheck {
    const check: TabularQuoteCheck = {
        field: citation.field,
        quote: clip(citation.quote, MAX_STORED_QUOTE_CHARS),
        document_id: documentId,
        status: match.status,
    };
    if (citation.page !== undefined) check.page = citation.page;
    if (citation.sheet) check.sheet = citation.sheet;
    if (citation.cell) check.cell = citation.cell;
    if (match.segments.length > 1) {
        check.segments = match.segments.length;
        check.segments_found = match.segments.filter(
            (segment) => segment.location,
        ).length;
    }
    const found = match.segments.flatMap((segment) =>
        segment.location ? [segment.location] : [],
    );
    if (found.length && sourceText !== null) {
        check.source_excerpt = clip(
            found.map((location) => location.excerpt).join(" … "),
            MAX_STORED_EXCERPT_CHARS,
        );
        check.context_before = contextBefore(
            sourceText,
            Math.min(...found.map((location) => location.start)),
        );
        check.context_after = contextAfter(
            sourceText,
            Math.max(...found.map((location) => location.end)),
        );
    }
    return check;
}

const MATCH_RANK: Record<TabularQuoteMatchStatus, number> = {
    found: 2,
    partly_found: 1,
    not_found: 0,
};

function cellQuoteStatus(checks: TabularQuoteCheck[]): TabularQuoteStatus {
    if (!checks.length) return "no_quote";
    if (checks.every((check) => check.status === "found")) return "found";
    if (checks.every((check) => check.status === "not_found")) {
        return "not_found";
    }
    return "partly_found";
}

/**
 * Prepare one row's sources and return the check for each of its cells.
 * Every source is normalized at most once however many cells and quotes the
 * row has. Call only for a row with text (see `rowHasNoText`).
 *
 * A quote is checked against the source document it cites. A citation that
 * names a document outside the row cannot have been found in its source. One
 * that names no document (an older answer) is checked against the row's only
 * source, or, in a folder row, against each source in turn.
 */
export function createCellQuoteChecker(
    text: RowDocumentText,
): (result: CellResult) => CellQuoteCheck {
    const sourceVersions = sourceVersionsOf(text);
    const sourcesById = new Map(
        text.sources.map((source) => [normalizeId(source.documentId), source]),
    );
    const prepared = new Map<string, QuoteSource>();
    const quoteSource = (id: string): QuoteSource => {
        let source = prepared.get(id);
        if (!source) {
            source = prepareQuoteSource(sourcesById.get(id)?.markdown ?? "");
            prepared.set(id, source);
        }
        return source;
    };

    const checkCitation = (citation: CellCitation): TabularQuoteCheck => {
        if (citation.documentId) {
            const id = normalizeId(citation.documentId);
            const source = sourcesById.get(id);
            if (!source) {
                return toQuoteCheck(
                    citation,
                    clip(citation.documentId, MAX_DOCUMENT_REFERENCE_CHARS),
                    { status: "not_found", segments: [] },
                    null,
                );
            }
            return toQuoteCheck(
                citation,
                source.documentId,
                matchQuote(quoteSource(id), citation.quote, CELL_QUOTE_MATCH),
                source.markdown,
            );
        }

        let best: {
            documentId: string;
            match: QuoteMatch;
            markdown: string;
        } | null = null;
        for (const [id, source] of sourcesById) {
            const match = matchQuote(
                quoteSource(id),
                citation.quote,
                CELL_QUOTE_MATCH,
            );
            if (!best || MATCH_RANK[match.status] > MATCH_RANK[best.match.status]) {
                best = {
                    documentId: source.documentId,
                    match,
                    markdown: source.markdown,
                };
            }
            if (match.status === "found") break;
        }
        if (!best || best.match.status === "not_found") {
            return toQuoteCheck(
                citation,
                text.sources.length === 1 ? text.sources[0].documentId : null,
                { status: "not_found", segments: best?.match.segments ?? [] },
                null,
            );
        }
        return toQuoteCheck(citation, best.documentId, best.match, best.markdown);
    };

    return (result) => {
        const checks = parseCellCitations(result).map(checkCitation);
        return {
            quote_status: cellQuoteStatus(checks),
            quote_checks: checks,
            source_versions: sourceVersions,
        };
    };
}

/**
 * Run a cell's check without letting a failure cost the answer: the answer is
 * then saved with no status (shown as not checked) and the failure reported.
 */
export function checkAnswerQuotes(
    check: (result: CellResult) => CellQuoteCheck,
    result: CellResult,
): CellQuoteCheck | null {
    try {
        return check(result);
    } catch (error) {
        const failure = new AppError(
            "tabular.quote_check_failed",
            "Tabular cell quote check failed",
            { cause: error },
        );
        reportError(failure);
        console.error("[tabular/quote-check] check failed", failure);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Reading checks back
// ---------------------------------------------------------------------------

const QUOTE_STATUSES: ReadonlySet<string> = new Set<TabularQuoteStatus>([
    "found",
    "partly_found",
    "not_found",
    "no_quote",
    "no_text",
]);

const MATCH_STATUSES: ReadonlySet<string> = new Set<TabularQuoteMatchStatus>([
    "found",
    "partly_found",
    "not_found",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function storedSourceVersions(
    value: unknown,
): Map<string, SourceVersionRecord> {
    const versions = new Map<string, SourceVersionRecord>();
    if (!isRecord(value)) return versions;
    for (const [documentId, entry] of Object.entries(value)) {
        if (!isRecord(entry)) continue;
        versions.set(documentId, {
            version_id:
                typeof entry.version_id === "string" ? entry.version_id : null,
            content_sha256:
                typeof entry.content_sha256 === "string"
                    ? entry.content_sha256
                    : null,
            has_text: entry.has_text !== false,
        });
    }
    return versions;
}

/** The documents whose text a stored cell's answer was drawn from. */
export function recordedSourceIds(cell: Record<string, unknown>): string[] {
    return cell.status === "done"
        ? [...storedSourceVersions(cell.source_versions).keys()]
        : [];
}

/**
 * A stored cell's quote-check fields as clients receive them. A cell without a
 * finished answer carries no check, and neither does one answered before
 * checks existed. `readable`, when given, limits the document ids shown to
 * those the caller may read.
 */
export function quoteFieldsOf(
    cell: Record<string, unknown>,
    readable?: ReadonlySet<string>,
): TabularCellQuoteFields {
    const status =
        cell.status === "done" &&
        typeof cell.quote_status === "string" &&
        QUOTE_STATUSES.has(cell.quote_status)
            ? (cell.quote_status as TabularQuoteStatus)
            : null;
    if (!status) {
        return { quote_status: null, quote_checks: [], no_text_document_ids: [] };
    }
    const quoteChecks = Array.isArray(cell.quote_checks)
        ? (cell.quote_checks.filter(
              (check) =>
                  isRecord(check) &&
                  typeof check.quote === "string" &&
                  typeof check.status === "string" &&
                  MATCH_STATUSES.has(check.status),
          ) as TabularQuoteCheck[])
        : [];
    const noText = [...storedSourceVersions(cell.source_versions)]
        .filter(([, version]) => !version.has_text)
        .map(([documentId]) => documentId)
        .filter((documentId) => !readable || readable.has(documentId));
    return {
        quote_status: status,
        quote_checks: quoteChecks,
        no_text_document_ids: noText,
    };
}

/** A just-written check as clients receive it (cell_update frames). */
export function quoteFieldsOfCheck(
    check: CellQuoteCheck | null,
): TabularCellQuoteFields {
    return quoteFieldsOf({ status: "done", ...(check ?? CLEARED_QUOTE_CHECK) });
}

/** A source's active version, as the cell's record of it is compared with. */
export type ActiveSourceVersion = {
    version_id: string | null;
    content_sha256: string | null;
};

/**
 * Whether the text a cell's answer was drawn from is still the text of each
 * source. A source has changed when another version became active, when the
 * active version's bytes were rewritten in place (accepting a tracked change
 * does that, and changes its content hash), or when the document is gone.
 * `active` holds the current active version of every document the caller may
 * read; ids outside `readable` count towards `stale` but are not listed.
 */
export function cellStaleness(
    cell: Record<string, unknown>,
    active: ReadonlyMap<string, ActiveSourceVersion>,
    readable: ReadonlySet<string>,
): TabularCellStaleness {
    if (cell.status !== "done") return { stale: false, stale_document_ids: [] };
    const changed = [...storedSourceVersions(cell.source_versions)]
        .filter(([documentId, recorded]) => {
            const current = active.get(documentId);
            return (
                !current ||
                current.version_id !== recorded.version_id ||
                current.content_sha256 !== recorded.content_sha256
            );
        })
        .map(([documentId]) => documentId);
    return {
        stale: changed.length > 0,
        stale_document_ids: changed.filter((documentId) =>
            readable.has(documentId),
        ),
    };
}

/**
 * Counts for a review's header. Quotes are counted one by one across answered
 * cells; rows not answered because a source has no extractable text are
 * counted separately and contribute no quotes, found or not.
 */
export function summarizeQuoteChecks(
    cells: ReadonlyArray<
        { row_id?: unknown; status?: unknown } & TabularCellQuoteFields &
            Partial<TabularCellStaleness>
    >,
): TabularQuoteSummary {
    const summary: TabularQuoteSummary = {
        quotes: 0,
        found: 0,
        partly_found: 0,
        not_found: 0,
        cells_without_quote: 0,
        cells_unchecked: 0,
        cells_stale: 0,
        rows_without_text: 0,
    };
    const rowsWithoutText = new Set<string>();
    for (const cell of cells) {
        if (cell.status !== "done") continue;
        if (!cell.quote_status) {
            summary.cells_unchecked += 1;
            continue;
        }
        if (cell.stale) summary.cells_stale += 1;
        if (cell.quote_status === "no_text") {
            rowsWithoutText.add(String(cell.row_id));
            continue;
        }
        if (cell.quote_status === "no_quote") summary.cells_without_quote += 1;
        for (const check of cell.quote_checks) {
            summary.quotes += 1;
            summary[check.status] += 1;
        }
    }
    summary.rows_without_text = rowsWithoutText.size;
    return summary;
}
