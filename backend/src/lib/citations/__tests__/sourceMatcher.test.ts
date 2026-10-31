// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { foldWithMap } from "../normalize";
import {
    DEFAULT_MAX_SEGMENT_GAP_CHARS,
    matchQuote,
    prepareQuoteSource,
} from "../sourceMatcher";

const SOURCE = [
    "## Page 1",
    "The Tenant shall pay rent of $10,000.00 on the first day of each month.",
    "The Landlord’s “Consent” shall not be unreasonably with\u00ADheld.",
    "This Agreement is gov-  erned by the laws of the State of New York.",
    "The ﬁnal invoice is due within 30 days.",
].join("\n");

describe("foldWithMap", () => {
    it("maps every folded character back to its original index", () => {
        const text = "A “ﬁne”\u00AD  word";
        const { norm, origIdx } = foldWithMap(text);
        expect(norm).toBe('a "fine" word');
        expect(norm.length).toBe(origIdx.length);
        // The ligature expands to two letters that both point at it.
        expect(origIdx[norm.indexOf("f")]).toBe(text.indexOf("ﬁ"));
        expect(origIdx[norm.indexOf("i")]).toBe(text.indexOf("ﬁ"));
    });

    it("keeps punctuation between digits in the tolerant form only", () => {
        expect(foldWithMap("$1,000.50 due, now.", { tolerant: true }).norm).toBe(
            "1,000.50duenow",
        );
        expect(foldWithMap("$1,000.50").norm).toBe("$1,000.50");
    });
});

describe("prepareQuoteSource.locate", () => {
    const source = prepareQuoteSource(SOURCE);

    it("returns an exact match with offsets into the source", () => {
        const location = source.locate("pay rent of $10,000.00");
        expect(location).not.toBeNull();
        expect(SOURCE.slice(location!.start, location!.end)).toBe(
            "pay rent of $10,000.00",
        );
    });

    it("folds whitespace and case", () => {
        const location = source.locate("the  tenant SHALL\npay rent");
        expect(location?.excerpt).toBe("The Tenant shall pay rent");
    });

    it("folds curly quotes, apostrophes and soft hyphens", () => {
        const location = source.locate(
            "The Landlord's \"Consent\" shall not be unreasonably withheld",
        );
        expect(location?.excerpt).toBe(
            "The Landlord’s “Consent” shall not be unreasonably with\u00ADheld",
        );
    });

    it("folds ligatures from PDF text layers", () => {
        expect(source.locate("The final invoice")?.excerpt).toBe(
            "The ﬁnal invoice",
        );
    });

    it("tolerates a stray comma and a line-break hyphen in a long quote", () => {
        expect(source.locate("pay rent, of $10,000.00 on the first day")).not
            .toBeNull();
        expect(source.locate("This Agreement is governed by the laws")?.excerpt)
            .toBe("This Agreement is gov-  erned by the laws");
    });

    it("never matches an amount whose separators differ", () => {
        // Both reduce to the digits 1000000 once punctuation is dropped.
        expect(source.locate("pay rent of $1,000,000 on the first day")).toBeNull();
        expect(source.locate("$1,000,000")).toBeNull();
    });

    it("does not let a short quote match by ignoring its punctuation", () => {
        const short = prepareQuoteSource("Section 5 applies; see clause i.");
        expect(short.locate("(i)")).toBeNull();
        expect(short.locate("§ 5")).toBeNull();
    });

    it("returns null for an altered quote", () => {
        expect(source.locate("The Tenant shall pay rent on the second day")).toBeNull();
    });
});

describe("prepareQuoteSource.locateFrom", () => {
    it("returns the earliest match at or after the offset in any tier", () => {
        const text = "PAY RENT now. Then pay rent again.";
        const source = prepareQuoteSource(text);
        // The exact match comes later than the case-folded one.
        expect(source.locateFrom("pay rent", 0)?.start).toBe(0);
        expect(source.locateFrom("pay rent", 1)?.start).toBe(
            text.indexOf("pay rent"),
        );
        expect(source.locateFrom("pay rent", text.length)).toBeNull();
    });
});

describe("matchQuote", () => {
    const source = prepareQuoteSource(SOURCE);
    const ordered = { orderedSegments: true };

    it("finds a contiguous quote", () => {
        const match = matchQuote(source, "on the first day of each month", ordered);
        expect(match.status).toBe("found");
        expect(match.segments).toHaveLength(1);
    });

    it.each(["...", "…"])(
        "finds parts separated by %s when they appear in order",
        (ellipsis) => {
            const match = matchQuote(
                source,
                `The Tenant shall pay rent${ellipsis}first day of each month`,
                ordered,
            );
            expect(match.status).toBe("found");
            expect(match.segments.every((segment) => segment.location)).toBe(true);
        },
    );

    it("reports parts found out of order as partly found", () => {
        const match = matchQuote(
            source,
            "first day of each month...The Tenant shall pay rent",
            ordered,
        );
        expect(match.status).toBe("partly_found");
        expect(match.segments.every((segment) => segment.location)).toBe(true);
    });

    it("finds out-of-order parts when order is not required", () => {
        expect(
            matchQuote(source, "first day of each month...The Tenant shall pay rent")
                .status,
        ).toBe("found");
    });

    it("reports a missing part as partly found", () => {
        const match = matchQuote(
            source,
            "The Tenant shall pay rent...and may sublet without consent",
            ordered,
        );
        expect(match.status).toBe("partly_found");
        expect(match.segments.map((segment) => !!segment.location)).toEqual([
            true,
            false,
        ]);
    });

    it("reports parts too far apart as partly found", () => {
        const far = prepareQuoteSource(
            `The Supplier shall not assign this Agreement.${" filler".repeat(
                DEFAULT_MAX_SEGMENT_GAP_CHARS / 4,
            )} The Customer shall be liable for late payment.`,
        );
        expect(
            matchQuote(far, "The Supplier shall not...be liable", ordered).status,
        ).toBe("partly_found");
        expect(
            matchQuote(far, "The Supplier shall not...be liable", {
                ...ordered,
                maxSegmentGapChars: 100_000,
            }).status,
        ).toBe("found");
    });

    it("reports an altered quote as not found", () => {
        const match = matchQuote(
            source,
            "The Tenant shall pay rent of $12,000.00 on the first day",
            ordered,
        );
        expect(match.status).toBe("not_found");
    });

    it("reports a quote without letters or digits as not found", () => {
        expect(matchQuote(source, "...", ordered)).toEqual({
            status: "not_found",
            segments: [],
        });
    });
});
