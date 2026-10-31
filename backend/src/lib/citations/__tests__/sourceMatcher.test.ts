// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { cutsIntoWord } from "../boundaries";
import { foldWithMap } from "../normalize";
import {
    DEFAULT_MAX_SEGMENT_GAP_CHARS,
    locatePartsInOrder,
    matchQuote,
    prepareQuoteSource,
    splitQuoteParts,
} from "../sourceMatcher";

const SOURCE = [
    "## Page 1",
    "The Tenant shall pay rent of $10,000.00 on the first day of each month.",
    "The Landlord’s “Consent” shall not be unreasonably with\u00ADheld.",
    "This Agreement is gov-  erned by the laws of the State of New York.",
    "The ﬁnal invoice is due within 30 days.",
].join("\n");

/**
 * Quotes that differ from their source only at an edge: a lost leading digit
 * or negating prefix, another currency, comparison or sign, or two numbers
 * run together. Each of them says something the source does not.
 */
const ALTERED_QUOTES: [string, string][] = [
    ["5 days before expiry", "Notice is due at least 15 days before expiry."],
    ["10,000.00 dollars", "The Buyer shall pay 110,000.00 dollars."],
    ["2.5% per annum", "Interest accrues at 12.5% per annum."],
    ["5% per annum", "Interest accrues at 2.5% per annum."],
    [
        "enforceable against the Guarantor",
        "This covenant is unenforceable against the Guarantor.",
    ],
    [
        "enforceable against the Guarantor",
        "This covenant is un-\nenforceable against the Guarantor.",
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
    ["0.50% per annum", "The Margin is −0.50% per annum."],
    ["Sections 12 and 13", "as set out in Sections 1, 2 and 13"],
    ["10 days of the notice", "within 5-10 days of the notice"],
    ["a rate of 10 per", "at a rate of 10.5 per cent"],
    ["the Guarantor shall", "each of the Guarantors shall"],
];

describe("foldWithMap", () => {
    it("maps every folded character back to its original index", () => {
        const text = "A “ﬁne”\u00AD  word";
        const { norm, origIdx } = foldWithMap(text);
        expect(norm).toBe('a "fine" word');
        expect(origIdx).toBeInstanceOf(Uint32Array);
        expect(norm.length).toBe(origIdx.length);
        // The ligature expands to two letters that both point at it.
        expect(origIdx[norm.indexOf("f")]).toBe(text.indexOf("ﬁ"));
        expect(origIdx[norm.indexOf("i")]).toBe(text.indexOf("ﬁ"));
    });

    it("keeps what a number says in the tolerant form", () => {
        expect(foldWithMap("$1,000.50 due, now.", { tolerant: true }).norm).toBe(
            "$1,000.50duenow",
        );
        expect(
            foldWithMap("a margin of -0.50% and a ratio ≥ 3.50 for €10", {
                tolerant: true,
            }).norm,
        ).toBe("amarginof-0.50%andaratio≥3.50for€10");
        expect(foldWithMap("SOFR + 2.5%, > 50%", { tolerant: true }).norm).toBe(
            "sofr+2.5%>50%",
        );
        expect(foldWithMap("$1,000.50").norm).toBe("$1,000.50");
    });

    it("drops punctuation that does not belong to a number in the tolerant form", () => {
        expect(
            foldWithMap("the COVID-19 plan | **Rent** > due <br>", {
                tolerant: true,
            }).norm,
        ).toBe("thecovid19planrentduebr");
    });

    it("keeps numbers apart where dropped characters stood between them", () => {
        expect(foldWithMap("Sections 1, 2 and 13", { tolerant: true }).norm).toBe(
            "sections1 2and13",
        );
        expect(foldWithMap("Sections 12 and 13", { tolerant: true }).norm).toBe(
            "sections12and13",
        );
    });
});

describe("cutsIntoWord", () => {
    const cuts = (text: string, part: string) => {
        const start = text.indexOf(part);
        return cutsIntoWord(text, start, start + part.length);
    };

    it("accepts a match at the edges of words and numbers", () => {
        expect(cuts("at least 15 days.", "15 days")).toBe(false);
        expect(cuts("(15) days", "15")).toBe(false);
        expect(cuts("the Landlord’s consent", "the Landlord")).toBe(false);
        expect(cuts("Section 1, 2 and 13", "Section 1")).toBe(false);
        expect(cuts("pre- and post-closing", "and post-closing")).toBe(false);
        expect(cuts("the Term—renewal", "renewal")).toBe(false);
        expect(cuts("l'Acheteur s'engage", "Acheteur")).toBe(false);
    });

    it("rejects a match that starts or ends inside a word or number", () => {
        expect(cuts("unenforceable", "enforceable")).toBe(true);
        expect(cuts("non-exclusive", "exclusive")).toBe(true);
        expect(cuts("the Guarantors", "the Guarantor")).toBe(true);
        expect(cuts("Company-wide", "Company")).toBe(true);
        expect(cuts("with\u00ADheld", "with")).toBe(true);
        expect(cuts("15 days", "5 days")).toBe(true);
        expect(cuts("Schedule 5A", "Schedule 5")).toBe(true);
        expect(cuts("2.5%", "5%")).toBe(true);
        expect(cuts("1,000", "000")).toBe(true);
        expect(cuts("10.5 per cent", "10")).toBe(true);
        expect(cuts("Section 1.2", "Section 1.")).toBe(true);
        expect(cuts("-0.50%", "0.50%")).toBe(true);
        expect(cuts("+2%", "2%")).toBe(true);
        expect(cuts("5–10 days", "10 days")).toBe(true);
        expect(cuts("enforce-\nable", "enforce")).toBe(true);
    });

    it("checks letters only in scripts that put spaces between words", () => {
        expect(cuts("本契約書に定める", "契約書")).toBe(false);
        expect(cuts("第15条", "5条")).toBe(true);
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
        // Starting partway through the ligature is starting inside a word.
        expect(source.locate("inal invoice")).toBeNull();
    });

    it("tolerates a stray comma, a space and a line-break hyphen in a long quote", () => {
        expect(source.locate("pay rent, of $10,000.00 on the first day")).not
            .toBeNull();
        expect(source.locate("pay rent of $ 10,000.00 on the first day")).not
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

    it.each(ALTERED_QUOTES)("does not find %j in %j", (quote, text) => {
        expect(prepareQuoteSource(text).locate(quote)).toBeNull();
    });

    it("finds a quote that keeps the whole word or number", () => {
        expect(
            prepareQuoteSource("Notice is due at least 15 days before expiry.")
                .locate("15 days before expiry"),
        ).not.toBeNull();
        expect(
            prepareQuoteSource("The Margin is −0.50% per annum.").locate(
                "-0.50% per annum",
            )?.excerpt,
        ).toBe("−0.50% per annum");
        expect(
            prepareQuoteSource("as set out in Sections 1, 2 and 13").locate(
                "Sections 1 2 and 13",
            ),
        ).not.toBeNull();
        expect(
            prepareQuoteSource("| Rent | $10,000 per month |").locate(
                "Rent $10,000 per month",
            ),
        ).not.toBeNull();
    });

    it("skips an occurrence inside a longer word for a later whole one", () => {
        const text = "It is unenforceable here, but enforceable there.";
        expect(prepareQuoteSource(text).locate("enforceable")?.start).toBe(
            text.indexOf("but enforceable") + 4,
        );
    });

    it("matches inside a run of text in scripts without spaces", () => {
        expect(prepareQuoteSource("本契約書に定める条件").locate("契約書")).not
            .toBeNull();
        expect(prepareQuoteSource("第15条に定める").locate("5条に定める")).toBeNull();
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

    it("returns the earliest match that also ends at or after a bound", () => {
        const text = "pay rent; PAY RENT; pay rent.";
        const source = prepareQuoteSource(text);
        expect(source.locateFrom("pay rent", 0, 8)?.start).toBe(0);
        expect(source.locateFrom("pay rent", 0, 9)?.start).toBe(10);
        expect(source.locateFrom("pay rent", 0, 19)?.start).toBe(20);
        expect(source.locateFrom("pay rent", 0, 29)).toBeNull();
    });
});

describe("splitQuoteParts", () => {
    it.each([
        "The Tenant shall...pay rent",
        "The Tenant shall…pay rent",
        "The Tenant shall . . . pay rent",
        "The Tenant shall [...] pay rent",
        "The Tenant shall […] pay rent",
        "The Tenant shall [ . . . ] pay rent",
        "The Tenant shall (...) pay rent",
        "The Tenant shall (…) pay rent",
        "The Tenant shall.... pay rent",
    ])("splits %j at its omission", (quote) => {
        expect(splitQuoteParts(quote)).toEqual(["The Tenant shall", "pay rent"]);
    });

    it("keeps clause numbers and drops parts without letters or digits", () => {
        expect(splitQuoteParts("Section 1.2.3 applies")).toEqual([
            "Section 1.2.3 applies",
        ]);
        expect(splitQuoteParts("[...] the Tenant shall pay rent ...")).toEqual([
            "the Tenant shall pay rent",
        ]);
        expect(splitQuoteParts("...")).toEqual([]);
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

    it.each(["...", "…", " . . . ", " [...] ", " […] ", " (…) "])(
        "finds parts separated by %j when they appear in order",
        (omission) => {
            const match = matchQuote(
                source,
                `The Tenant shall pay rent${omission}first day of each month`,
                ordered,
            );
            expect(match.status).toBe("found");
            expect(match.segments.map((segment) => segment.text)).toEqual([
                "The Tenant shall pay rent",
                "first day of each month",
            ]);
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

    it("finds a shortened quote in a long document whose first part repeats", () => {
        // Forty clauses open the same way before the one quoted, each longer
        // than the gap allowed between the parts of a quote.
        const clauses = Array.from(
            { length: 40 },
            (_, n) =>
                `${n + 1}. The Tenant shall keep the Premises in good repair ` +
                `and shall comply with rule ${n + 1}. ` +
                "Notices go to the address in the Schedule. ".repeat(50),
        );
        const lease = [
            ...clauses,
            "41. The Tenant shall indemnify the Landlord against all claims.",
        ].join("\n");
        expect(lease.length).toBeGreaterThan(80_000);
        const match = matchQuote(
            prepareQuoteSource(lease),
            "The Tenant shall ... indemnify the Landlord",
            ordered,
        );
        expect(match.status).toBe("found");
        expect(match.segments[0].location!.start).toBe(
            lease.indexOf("41. The Tenant shall") + 4,
        );
    });

    it("finds the one close pair after hundreds of pairs too far apart", () => {
        const gap = " x".repeat(DEFAULT_MAX_SEGMENT_GAP_CHARS / 2 + 1);
        const text = `${`alpha${gap} omega `.repeat(300)}alpha omega.`;
        const chain = locatePartsInOrder(
            prepareQuoteSource(text),
            ["alpha", "omega"],
            DEFAULT_MAX_SEGMENT_GAP_CHARS,
        );
        expect(chain?.map((location) => location.start)).toEqual([
            text.lastIndexOf("alpha"),
            text.lastIndexOf("omega"),
        ]);
        expect(
            locatePartsInOrder(
                prepareQuoteSource(`alpha${gap} omega `.repeat(300)),
                ["alpha", "omega"],
                DEFAULT_MAX_SEGMENT_GAP_CHARS,
            ),
        ).toBeNull();
    });

    it("reports an altered quote as not found", () => {
        const match = matchQuote(
            source,
            "The Tenant shall pay rent of $12,000.00 on the first day",
            ordered,
        );
        expect(match.status).toBe("not_found");
    });

    it.each(ALTERED_QUOTES)("reports %j as not found in %j", (quote, text) => {
        expect(matchQuote(prepareQuoteSource(text), quote, ordered).status).toBe(
            "not_found",
        );
    });

    it("reports a quote without letters or digits as not found", () => {
        expect(matchQuote(source, "...", ordered)).toEqual({
            status: "not_found",
            segments: [],
        });
    });
});
