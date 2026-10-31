// SPDX-License-Identifier: AGPL-3.0-only
//
// Quote checks for tabular cells: what is matched, against which source, and
// how a cell, a stale source and a row without text are reported.

import { describe, expect, it, vi } from "vitest";
import type { RowDocumentText } from "../tabular.rows";
import type { CellResult } from "../tabular.shared";
import {
    cellStaleness,
    checkAnswerQuotes,
    createCellQuoteChecker,
    noTextQuoteCheck,
    parseCellCitations,
    quoteChecksOf,
    quoteFieldsOf,
    quoteStatusOf,
    quoteStatusOfCheck,
    rowExtractionFailed,
    rowHasNoText,
    summarizeQuoteChecks,
    type ActiveSourceVersion,
} from "../tabular.verify";

const LEASE = [
    "## Page 1",
    "",
    "The Tenant shall pay rent of $10,000.00 on the first day of each month.",
    "The Landlord’s “Consent” shall not be unreasonably withheld.",
    "",
    "## Page 2",
    "",
    "Either party may terminate this Lease on ninety days’ written notice.",
].join("\n");

const SCHEDULE = [
    "## Page 1",
    "",
    "Schedule A describes the Premises at 10 Main Street.",
    "The Deposit equals two months of rent.",
].join("\n");

type SourceSpec = {
    id: string;
    markdown: string;
    version?: string;
    hash?: string | null;
};

function rowText(sources: SourceSpec[]): RowDocumentText {
    return {
        text: sources
            .map(
                (source) =>
                    `## Source document: ${source.id}.pdf\nSource document ID: ${source.id}\n\n${source.markdown}`,
            )
            .join("\n\n---\n\n"),
        sources: sources.map((source) => ({
            documentId: source.id,
            versionId: source.version ?? `${source.id}-v1`,
            contentSha256: source.hash ?? null,
            filename: `${source.id}.pdf`,
            markdown: source.markdown,
        })),
    };
}

const answer = (summary: string, reasoning = ""): CellResult => ({
    summary,
    flag: "green",
    reasoning,
});

const cite = (document: string, quote: string, page = 1) =>
    `[[document:${document}||page:${page}||quote:${quote}]]`;

describe("parseCellCitations", () => {
    it("reads citations from the summary and the reasoning as the grid does", () => {
        expect(
            parseCellCitations({
                summary: `Monthly ${cite("doc-a", "pay rent")} [[Yes]] and [[USD]]`,
                reasoning:
                    "See [[document:doc-s||sheet:Summary||cell:B7||quote:42]] and [[page:2||quote:Legacy language]]",
            }),
        ).toEqual([
            { field: "summary", documentId: "doc-a", page: 1, quote: "pay rent" },
            {
                field: "reasoning",
                documentId: "doc-s",
                sheet: "Summary",
                cell: "B7",
                quote: "42",
            },
            {
                field: "reasoning",
                documentId: undefined,
                page: 2,
                quote: "Legacy language",
            },
        ]);
    });

    it("skips a citation whose quote has no letters or digits", () => {
        expect(parseCellCitations({ summary: cite("doc-a", "--") })).toEqual([]);
    });
});

describe("checking a cell's quotes against its row's text", () => {
    const check = createCellQuoteChecker(rowText([{ id: "doc-a", markdown: LEASE }]));

    it("finds a quote present in the row's text", () => {
        const result = check(
            answer(`Rent is due monthly ${cite("doc-a", "on the first day of each month")}`),
        );
        expect(result.quote_status).toBe("found");
        expect(result.quote_checks).toEqual([
            expect.objectContaining({
                field: "summary",
                quote: "on the first day of each month",
                document_id: "doc-a",
                page: 1,
                status: "found",
                source_excerpt: "on the first day of each month",
                context_before: "## Page 1 The Tenant shall pay rent of $10,000.00 ",
            }),
        ]);
        expect(result.quote_checks[0].context_after).toMatch(
            /^\. The Landlord’s “Consent”/,
        );
    });

    it("keeps whole words in the source text around a match", () => {
        const filler = "alpha beta gamma delta ".repeat(20);
        const long = createCellQuoteChecker(
            rowText([
                { id: "doc-a", markdown: `${filler}The quoted clause ends here. ${filler}` },
            ]),
        );
        const [quote] = long(
            answer(cite("doc-a", "The quoted clause ends here")),
        ).quote_checks;
        expect(quote.context_before!.length).toBeLessThanOrEqual(160);
        expect(quote.context_before).toMatch(/^(alpha|beta|gamma|delta) /);
        expect(quote.context_before).toMatch(/delta $/);
        expect(quote.context_after).toMatch(/^\. alpha beta/);
        expect(quote.context_after).toMatch(/(alpha|beta|gamma|delta)$/);
    });

    it("finds a quote that differs only in whitespace and quote characters", () => {
        const result = check(
            answer(
                `Consent needed ${cite("doc-a", 'The  Landlord\'s "Consent"\nshall not be unreasonably withheld')}`,
            ),
        );
        expect(result.quote_status).toBe("found");
        expect(result.quote_checks[0].source_excerpt).toBe(
            "The Landlord’s “Consent” shall not be unreasonably withheld",
        );
    });

    it("finds a quote whose omitted parts all appear in order", () => {
        const result = check(
            answer(
                `Rent ${cite("doc-a", "The Tenant shall pay rent...on the first day of each month")}`,
            ),
        );
        expect(result.quote_status).toBe("found");
        expect(result.quote_checks[0]).toMatchObject({
            status: "found",
            segments: 2,
            segments_found: 2,
            source_excerpt: "The Tenant shall pay rent … on the first day of each month",
        });
    });

    it("reports a quote with a missing part as partly found", () => {
        const result = check(
            answer(
                `Rent ${cite("doc-a", "The Tenant shall pay rent…together with a late fee of five percent")}`,
            ),
        );
        expect(result.quote_status).toBe("partly_found");
        expect(result.quote_checks[0]).toMatchObject({
            status: "partly_found",
            segments: 2,
            segments_found: 1,
            source_excerpt: "The Tenant shall pay rent",
        });
    });

    it("reports a quote whose parts appear out of order as partly found", () => {
        const result = check(
            answer(
                `Rent ${cite("doc-a", "on the first day of each month...The Tenant shall pay rent")}`,
            ),
        );
        expect(result.quote_status).toBe("partly_found");
        expect(result.quote_checks[0]).toMatchObject({
            status: "partly_found",
            segments: 2,
            segments_found: 2,
        });
    });

    it("reports an altered quote as not found", () => {
        const result = check(
            answer(`Rent ${cite("doc-a", "The Tenant shall pay rent of $12,000.00")}`),
        );
        expect(result.quote_status).toBe("not_found");
        expect(result.quote_checks[0].status).toBe("not_found");
        expect(result.quote_checks[0].source_excerpt).toBeUndefined();
    });

    it.each([
        ["5 days before expiry", "Notice is due at least 15 days before expiry."],
        ["10,000.00 dollars", "The Buyer shall pay 110,000.00 dollars."],
        ["2.5% per annum", "Interest accrues at 12.5% per annum."],
        [
            "enforceable against the Guarantor",
            "This covenant is unenforceable against the Guarantor.",
        ],
        [
            "exclusive licence to use the Software",
            "The Customer has a non-exclusive licence to use the Software.",
        ],
        [
            "pay rent of €10,000.00 per month",
            "The Tenant shall pay rent of $10,000.00 per month.",
        ],
        [
            "the Leverage Ratio ≥ 3.50",
            "The Borrower shall keep the Leverage Ratio ≤ 3.50 at all times.",
        ],
        ["0.50% per annum", "The Margin is -0.50% per annum."],
        ["Sections 12 and 13", "as set out in Sections 1, 2 and 13"],
    ])("reports %j as not found in %j", (quote, text) => {
        const checkOne = createCellQuoteChecker(rowText([{ id: "doc-a", markdown: text }]));
        const result = checkOne(answer(`Clause ${cite("doc-a", quote)}`));
        expect(result.quote_status).toBe("not_found");
        expect(result.quote_checks[0].source_excerpt).toBeUndefined();
    });

    it.each([
        "The Tenant shall [...] on the first day of each month",
        "The Tenant shall . . . on the first day of each month",
        "The Tenant shall (…) on the first day of each month",
    ])("finds a quote whose omission is marked as in %j", (quote) => {
        const result = check(answer(`Rent ${cite("doc-a", quote)}`));
        expect(result.quote_status).toBe("found");
        expect(result.quote_checks[0]).toMatchObject({
            segments: 2,
            segments_found: 2,
        });
    });

    it("finds a shortened quote whose first part repeats through a long document", () => {
        const clauses = Array.from(
            { length: 40 },
            (_, n) =>
                `${n + 1}. The Tenant shall comply with rule ${n + 1}. ` +
                "Notices go to the address in the Schedule. ".repeat(50),
        );
        const lease = [
            ...clauses,
            "41. The Tenant shall indemnify the Landlord against all claims.",
        ].join("\n");
        const long = createCellQuoteChecker(rowText([{ id: "doc-a", markdown: lease }]));
        const result = long(
            answer(`Indemnity ${cite("doc-a", "The Tenant shall ... indemnify the Landlord")}`),
        );
        expect(result.quote_status).toBe("found");
    });

    it("summarizes a cell with found and missing quotes as partly found", () => {
        const result = check(
            answer(
                `Rent ${cite("doc-a", "The Tenant shall pay rent")}`,
                `Also ${cite("doc-a", "rent may be withheld at any time", 2)}`,
            ),
        );
        expect(result.quote_status).toBe("partly_found");
        expect(result.quote_checks.map((quote) => [quote.field, quote.status])).toEqual([
            ["summary", "found"],
            ["reasoning", "not_found"],
        ]);
    });

    it("reports an answer without quotes as no_quote", () => {
        const result = check(answer("Not Found", "The lease does not address this."));
        expect(result).toMatchObject({ quote_status: "no_quote", quote_checks: [] });
    });
});

describe("a folder row with two documents", () => {
    const text = rowText([
        { id: "doc-a", markdown: LEASE, version: "a-v1", hash: "aaa" },
        { id: "doc-b", markdown: SCHEDULE, version: "b-v1", hash: null },
    ]);
    const check = createCellQuoteChecker(text);

    it("checks each quote against the document it cites", () => {
        const result = check(
            answer(
                `Rent ${cite("doc-a", "pay rent of $10,000.00")} at the Premises ${cite("DOC-B", "10 Main Street")}`,
            ),
        );
        expect(result.quote_status).toBe("found");
        expect(result.quote_checks.map((quote) => quote.document_id)).toEqual([
            "doc-a",
            "doc-b",
        ]);
    });

    it("does not find a quote in a document it does not cite", () => {
        // The text is in doc-b, but the citation names doc-a.
        const result = check(answer(`Premises ${cite("doc-a", "10 Main Street")}`));
        expect(result.quote_status).toBe("not_found");
        expect(result.quote_checks[0]).toMatchObject({
            document_id: "doc-a",
            status: "not_found",
        });
    });

    it("reports a citation of a document outside the row as not found", () => {
        const result = check(answer(`Rent ${cite("doc-z", "pay rent of $10,000.00")}`));
        // What the answer wrote is kept for display, never as a document id.
        expect(result.quote_checks[0]).toMatchObject({
            document_id: null,
            cited_reference: "doc-z",
            status: "not_found",
        });
    });

    it("looks for a quote that names no document in each source", () => {
        const result = check(answer("Deposit [[page:1||quote:two months of rent]]"));
        expect(result.quote_checks[0]).toMatchObject({
            document_id: "doc-b",
            status: "found",
        });
        const missing = check(answer("Deposit [[page:1||quote:three months of rent]]"));
        expect(missing.quote_checks[0]).toMatchObject({
            document_id: null,
            status: "not_found",
        });
    });

    it("records the version of each source it read", () => {
        expect(check(answer("Not Found")).source_versions).toEqual({
            "doc-a": { version_id: "a-v1", content_sha256: "aaa", has_text: true },
            "doc-b": { version_id: "b-v1", content_sha256: null, has_text: true },
        });
    });

    describe("staleness", () => {
        const stored = {
            status: "done",
            ...check(answer(`Rent ${cite("doc-a", "pay rent")}`)),
        };
        const readable = new Set(["doc-a", "doc-b"]);
        const active = (
            overrides: Record<string, ActiveSourceVersion | undefined> = {},
        ) => {
            const versions = new Map<string, ActiveSourceVersion>([
                ["doc-a", { version_id: "a-v1", content_sha256: "aaa" }],
                ["doc-b", { version_id: "b-v1", content_sha256: null }],
            ]);
            for (const [id, version] of Object.entries(overrides)) {
                if (version) versions.set(id, version);
                else versions.delete(id);
            }
            return versions;
        };

        it("is fresh while every source keeps the version it read", () => {
            expect(cellStaleness(stored, active(), readable)).toEqual({
                stale: false,
                stale_document_ids: [],
            });
        });

        it.each([
            ["doc-a", { version_id: "a-v2", content_sha256: "bbb" }],
            ["doc-b", { version_id: "b-v2", content_sha256: null }],
        ])("goes stale when a new version of %s is activated", (id, version) => {
            expect(cellStaleness(stored, active({ [id]: version }), readable)).toEqual({
                stale: true,
                stale_document_ids: [id],
            });
        });

        it("goes stale when the active version is rewritten in place", () => {
            expect(
                cellStaleness(
                    stored,
                    active({ "doc-b": { version_id: "b-v1", content_sha256: "new" } }),
                    readable,
                ),
            ).toEqual({ stale: true, stale_document_ids: ["doc-b"] });
        });

        it("goes stale when a source is gone, without naming one the caller cannot read", () => {
            expect(
                cellStaleness(stored, active({ "doc-a": undefined }), new Set(["doc-b"])),
            ).toEqual({ stale: true, stale_document_ids: [] });
        });

        it("never reports a cell without a finished answer as stale", () => {
            expect(
                cellStaleness({ ...stored, status: "pending" }, active({ "doc-a": undefined }), readable),
            ).toEqual({ stale: false, stale_document_ids: [] });
        });
    });
});

describe("a row whose source yields no text", () => {
    const scanned = rowText([
        { id: "doc-a", markdown: LEASE },
        { id: "doc-b", markdown: "  \n " },
    ]);

    it("is a row without text when any source is empty, or it has none", () => {
        expect(rowHasNoText(scanned)).toBe(true);
        expect(rowHasNoText(rowText([{ id: "doc-a", markdown: "" }]))).toBe(true);
        expect(rowHasNoText({ text: "", sources: [] })).toBe(true);
        expect(rowHasNoText(rowText([{ id: "doc-a", markdown: LEASE }]))).toBe(false);
    });

    it("records no_text, no quotes, and which source had no text", () => {
        const check = noTextQuoteCheck(scanned);
        expect(check).toEqual({
            quote_status: "no_text",
            quote_checks: [],
            source_versions: {
                "doc-a": { version_id: "doc-a-v1", content_sha256: null, has_text: true },
                "doc-b": { version_id: "doc-b-v1", content_sha256: null, has_text: false },
            },
        });
        expect(quoteStatusOfCheck(check)).toEqual({
            quote_status: "no_text",
            quote_outcomes: [],
        });
        expect(quoteFieldsOf({ status: "done", ...check })).toEqual({
            quote_status: "no_text",
            quote_outcomes: [],
            no_text_document_ids: ["doc-b"],
        });
    });

    it("tells a source whose extraction failed from one without text", () => {
        const failed: RowDocumentText = {
            ...scanned,
            sources: scanned.sources.map((source) =>
                source.documentId === "doc-b"
                    ? { ...source, extractionFailed: true as const }
                    : source,
            ),
        };
        expect(rowExtractionFailed(failed)).toBe(true);
        expect(rowExtractionFailed(scanned)).toBe(false);
    });

    it("is counted on its own, outside the found and not-found counts", () => {
        const checked = createCellQuoteChecker(rowText([{ id: "doc-a", markdown: LEASE }]));
        const noText = noTextQuoteCheck(scanned);
        const cells = [
            {
                row_id: "row-1",
                status: "done",
                ...checked(
                    answer(
                        `${cite("doc-a", "pay rent")} ${cite("doc-a", "ninety days’ written notice", 2)}`,
                    ),
                ),
            },
            {
                row_id: "row-2",
                status: "done",
                ...checked(answer(`${cite("doc-a", "pay rent")} ${cite("doc-a", "rent is waived")}`)),
            },
            { row_id: "row-3", status: "done", ...checked(answer("Not Found")) },
            // Both cells of the scanned row; one even carries a stray entry,
            // which must not be counted.
            { row_id: "row-4", status: "done", ...noText },
            {
                row_id: "row-4",
                status: "done",
                ...noText,
                quote_checks: [
                    { field: "summary", quote: "x", document_id: null, status: "not_found" },
                ],
            },
            // Not finished yet, and answered before checks existed.
            { row_id: "row-5", status: "pending", content: null },
            { row_id: "row-6", status: "done", content: '{"summary":"x"}' },
        ].map((cell) => ({ ...cell, ...quoteFieldsOf(cell) }));

        expect(summarizeQuoteChecks(cells)).toEqual({
            quotes: 4,
            found: 3,
            partly_found: 0,
            not_found: 1,
            cells_without_quote: 1,
            cells_unchecked: 1,
            cells_stale: 0,
            rows_without_text: 1,
        });
    });
});

describe("reading stored checks back", () => {
    const stored = {
        row_id: "row-1",
        column_index: 2,
        status: "done",
        quote_status: "partly_found",
        quote_checks: [
            {
                field: "summary",
                quote: "a",
                document_id: "doc-a",
                status: "found",
                source_excerpt: "a",
                context_before: "before",
            },
            {
                field: "reasoning",
                quote: "b ... c",
                document_id: "doc-a",
                status: "partly_found",
                segments: 2,
                segments_found: 1,
            },
            { field: "summary", quote: "d", document_id: "doc-a", status: "bogus" },
            { field: "elsewhere", quote: "e", document_id: "doc-a", status: "found" },
            "not an entry",
        ],
        source_versions: {
            "doc-a": { version_id: "v1", content_sha256: null, has_text: true },
        },
    };

    it("gives the grid each quote's outcome without its text or source passage", () => {
        expect(quoteStatusOf(stored)).toEqual({
            quote_status: "partly_found",
            quote_outcomes: [
                { field: "summary", status: "found" },
                {
                    field: "reasoning",
                    status: "partly_found",
                    segments: 2,
                    segments_found: 1,
                },
            ],
        });
        expect(quoteFieldsOf(stored)).toEqual({
            ...quoteStatusOf(stored),
            no_text_document_ids: [],
        });
    });

    it("gives the quote-checks endpoint the well-formed entries in full", () => {
        expect(quoteChecksOf(stored, new Set(["doc-a"]))).toEqual({
            row_id: "row-1",
            column_index: 2,
            quote_status: "partly_found",
            quote_checks: stored.quote_checks.slice(0, 2),
            no_text_document_ids: [],
        });
    });

    it.each(["pending", "generating", "error"])(
        "returns no check for a %s cell",
        (status) => {
            expect(quoteFieldsOf({ ...stored, status })).toEqual({
                quote_status: null,
                quote_outcomes: [],
                no_text_document_ids: [],
            });
            expect(quoteChecksOf({ ...stored, status }, new Set())).toMatchObject({
                quote_status: null,
                quote_checks: [],
            });
        },
    );

    it("returns no check for an answer written before checks existed", () => {
        expect(quoteFieldsOf({ status: "done", content: "{}" }).quote_status).toBeNull();
    });

    it("lists only sources without text that the caller may read", () => {
        const noText = {
            status: "done",
            quote_status: "no_text",
            quote_checks: [],
            source_versions: {
                "doc-a": { version_id: "v1", content_sha256: null, has_text: false },
                "doc-b": { version_id: "v1", content_sha256: null, has_text: false },
            },
        };
        expect(quoteFieldsOf(noText).no_text_document_ids).toEqual(["doc-a", "doc-b"]);
        expect(quoteFieldsOf(noText, new Set(["doc-b"])).no_text_document_ids).toEqual([
            "doc-b",
        ]);
        expect(
            quoteChecksOf(noText, new Set(["doc-a"])).no_text_document_ids,
        ).toEqual(["doc-a"]);
    });
});

describe("checkAnswerQuotes", () => {
    const text = rowText([{ id: "doc-a", markdown: LEASE }]);

    it("returns the cell's check", () => {
        const check = createCellQuoteChecker(text);
        expect(
            checkAnswerQuotes(text, check, answer(cite("doc-a", "pay rent"))).quote_status,
        ).toBe("found");
    });

    it("leaves the answer unchecked, with its sources' versions, and reports a check that fails", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        let unchecked;
        try {
            unchecked = checkAnswerQuotes(
                text,
                () => {
                    throw new Error("boom");
                },
                answer("x"),
            );
            expect(logged).toHaveBeenCalledWith(
                "[tabular/quote-check] check failed",
                expect.objectContaining({ kind: "tabular.quote_check_failed" }),
            );
        } finally {
            logged.mockRestore();
        }
        expect(unchecked).toEqual({
            quote_status: null,
            quote_checks: null,
            source_versions: {
                "doc-a": { version_id: "doc-a-v1", content_sha256: null, has_text: true },
            },
        });
        expect(quoteStatusOfCheck(unchecked!)).toEqual({
            quote_status: null,
            quote_outcomes: [],
        });
        // The versions it read are kept, so the cell still goes stale.
        expect(
            cellStaleness(
                { status: "done", ...unchecked },
                new Map([["doc-a", { version_id: "doc-a-v2", content_sha256: null }]]),
                new Set(["doc-a"]),
            ),
        ).toEqual({ stale: true, stale_document_ids: ["doc-a"] });
        expect(
            summarizeQuoteChecks([
                { row_id: "row-1", status: "done", ...quoteStatusOfCheck(unchecked!), stale: true },
            ]),
        ).toMatchObject({ cells_unchecked: 1, cells_stale: 1, quotes: 0 });
    });
});
