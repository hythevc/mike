// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// The rules of the security facts registry (../site/securityFacts.ts): a
// fact that is not in place yet must say when it is due, a date belongs to a
// planned fact only, and the facts the pricing page shows are always facts of
// the registry, printed the way the security page prints them.
import { describe, expect, it } from "vitest";
import {
    INDEPENDENT_ASSESSMENTS,
    INDEPENDENT_ASSESSMENT_FACT_ID,
    SECURITY_FACTS_COPY,
    TRUST_STRIP_FACT_IDS,
    plannedDateLabel,
    securityFactLine,
    securityFactProblems,
    securityFacts,
    securityFactsSummary,
    trustStripFacts,
    type SecurityFact,
} from "../site/securityFacts";

const IN_PLACE: SecurityFact = {
    id: "example-in-place",
    status: "in place",
    text: "An example fact that is true today.",
};
const PLANNED: SecurityFact = {
    id: "example-planned",
    status: "planned",
    date: "2099-03",
    text: "An example fact that is not true yet.",
};

/** A fact as a hand edit could leave it, past what the type allows. */
const loose = (fact: Record<string, unknown>) => fact as unknown as SecurityFact;

describe("the security facts registry", () => {
    it("is publishable as it stands, checked against today's date", () => {
        // Passing today's date also refuses a planned fact whose date has
        // passed: it must be marked "in place" or given a new date.
        expect(securityFactProblems(securityFacts(), { today: new Date() })).toEqual([]);
    });

    it("gives every planned fact a date, and a date to planned facts only", () => {
        for (const fact of securityFacts()) {
            if (fact.status === "planned") {
                expect(fact.date, fact.id).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
            } else {
                expect(fact.date, fact.id).toBeUndefined();
            }
        }
    });

    it("states each fact as one sentence, under an id of its own", () => {
        const facts = securityFacts();
        expect(facts.length).toBeGreaterThan(4);
        expect(new Set(facts.map((fact) => fact.id)).size).toBe(facts.length);
        for (const fact of facts) {
            expect(fact.text, fact.id).toMatch(/^[A-Z].*\.$/);
        }
    });

    it("ends with whether anyone outside has assessed the service", () => {
        expect(INDEPENDENT_ASSESSMENTS).toEqual([]);
        const last = securityFacts().at(-1)!;
        expect(last.id).toBe(INDEPENDENT_ASSESSMENT_FACT_ID);
        // No assessment is recorded, so the fact claims nothing and carries
        // no status: it is neither in place nor planned.
        expect(last.status).toBeUndefined();
        expect(last.text).toBe("No outside party has certified or audited this service yet.");
    });

    it("names a recorded assessment instead, once the operator records one", () => {
        const facts = securityFacts([
            {
                name: "Example assessment",
                assessor: "Example assessor",
                completed: "2026-01",
                scope: "The web application and API.",
            },
        ]);
        const last = facts.at(-1)!;
        expect(last.status).toBe("in place");
        expect(last.text).toBe("Independent assessments on record: Example assessment.");
        expect(securityFactProblems(facts)).toEqual([]);
    });
});

describe("securityFactProblems", () => {
    it("accepts a fact in place, a planned fact with a date and a plain statement", () => {
        expect(
            securityFactProblems([
                IN_PLACE,
                PLANNED,
                { id: "plain", text: "A plain statement." },
            ]),
        ).toEqual([]);
    });

    it("refuses a planned fact with no date", () => {
        expect(
            securityFactProblems([
                loose({ id: "no-date", status: "planned", text: "Not yet true." }),
            ]),
        ).toEqual(["no-date: a planned fact must carry the date it is due."]);
        expect(
            securityFactProblems([
                loose({ id: "empty-date", status: "planned", date: "", text: "Not yet true." }),
            ]),
        ).toEqual(["empty-date: a planned fact must carry the date it is due."]);
    });

    it.each(["soon", "Q3 2027", "2027", "2027-13", "2027-02-30", "27-03", "2027-3"])(
        "refuses the planned date %s",
        (date) => {
            expect(
                securityFactProblems([
                    loose({ id: "bad-date", status: "planned", date, text: "Not yet true." }),
                ]),
            ).toEqual(["bad-date: the date must be YYYY-MM or YYYY-MM-DD."]);
        },
    );

    it("refuses a date on a fact that is not planned", () => {
        expect(
            securityFactProblems([
                loose({ id: "dated", status: "in place", date: "2027-03", text: "True today." }),
                loose({ id: "dated-plain", date: "2027-03", text: "A statement." }),
            ]),
        ).toEqual([
            "dated: only a planned fact may carry a date.",
            "dated-plain: only a planned fact may carry a date.",
        ]);
    });

    it("refuses a status other than the two", () => {
        expect(
            securityFactProblems([loose({ id: "odd", status: "coming soon", text: "Something." })]),
        ).toEqual(['odd: the status must be "in place" or "planned".']);
    });

    it("refuses a missing id, a repeated id and a text that is not a sentence", () => {
        expect(
            securityFactProblems([
                IN_PLACE,
                { ...IN_PLACE },
                loose({ id: " ", status: "in place", text: "A sentence." }),
                loose({ id: "no-text", status: "in place", text: " " }),
                loose({ id: "no-stop", status: "in place", text: "No full stop" }),
            ]),
        ).toEqual([
            "example-in-place: the id is used twice.",
            "A security fact has no id.",
            "no-text: the text is empty.",
            "no-stop: the text must be a sentence ending in a full stop.",
        ]);
    });

    it("refuses a planned date that has passed, only when told today's date", () => {
        const month = loose({ id: "month", status: "planned", date: "2027-03", text: "Due." });
        const day = loose({ id: "day", status: "planned", date: "2027-03-15", text: "Due." });
        const passed = (id: string) =>
            `${id}: its planned date has passed. Mark it "in place" once it is true, or give it a new date.`;

        // A month is due until its last day; a day until that day ends.
        expect(securityFactProblems([month], { today: new Date("2027-03-31T23:00:00Z") })).toEqual([]);
        expect(securityFactProblems([month], { today: new Date("2027-04-01T00:00:00Z") })).toEqual([
            passed("month"),
        ]);
        expect(securityFactProblems([day], { today: new Date("2027-03-15T23:00:00Z") })).toEqual([]);
        expect(securityFactProblems([day], { today: new Date("2027-03-16T00:00:00Z") })).toEqual([
            passed("day"),
        ]);
        // A page request passes no date, so it never fails for this reason.
        expect(securityFactProblems([month, day])).toEqual([]);
    });
});

describe("how a fact is printed", () => {
    it("writes a planned date in words", () => {
        expect(plannedDateLabel("2027-03")).toBe("March 2027");
        expect(plannedDateLabel("2027-03-15")).toBe("March 15, 2027");
        expect(plannedDateLabel("2027-12-31")).toBe("December 31, 2027");
        expect(() => plannedDateLabel("next year")).toThrow(/Not a planned date/);
    });

    it("prints a fact in place as its sentence, and a planned one with its date first", () => {
        expect(securityFactLine(IN_PLACE)).toBe(IN_PLACE.text);
        expect(securityFactLine(PLANNED)).toBe(
            "Planned for March 2099: An example fact that is not true yet.",
        );
        expect(securityFactLine({ id: "plain", text: "A plain statement." })).toBe(
            "A plain statement.",
        );
    });

    it("never prints a planned fact without its date", () => {
        const line = securityFactLine(PLANNED);
        expect(line.startsWith(SECURITY_FACTS_COPY.plannedPrefix("March 2099"))).toBe(true);
        expect(() =>
            securityFactLine(loose({ id: "x", status: "planned", text: "Not yet." })),
        ).toThrow();
    });
});

describe("the security page's summary", () => {
    it("lists the facts in place, then the planned ones with their dates, then plain statements", () => {
        const summary = securityFactsSummary([
            IN_PLACE,
            PLANNED,
            { id: "plain", text: "A plain statement." },
        ]);
        expect(summary).toBe(
            [
                "In place today:",
                "",
                "- An example fact that is true today.",
                "",
                "Not in place yet:",
                "",
                "- Planned for March 2099: An example fact that is not true yet.",
                "",
                "A plain statement.",
            ].join("\n"),
        );
    });

    it("leaves out a list that would be empty", () => {
        const summary = securityFactsSummary([IN_PLACE]);
        expect(summary).toContain(SECURITY_FACTS_COPY.inPlaceLead);
        expect(summary).not.toContain(SECURITY_FACTS_COPY.plannedLead);
    });

    it("refuses to publish a planned fact with no date", () => {
        expect(() =>
            securityFactsSummary([
                loose({ id: "no-date", status: "planned", text: "Not yet true." }),
            ]),
        ).toThrow(/a planned fact must carry the date it is due/);
    });

    it("prints the real registry", () => {
        const summary = securityFactsSummary();
        for (const fact of securityFacts()) {
            expect(summary, fact.id).toContain(securityFactLine(fact));
        }
    });
});

describe("the facts the pricing page shows", () => {
    it("are a subset of the registry, in the order the page lists them", () => {
        const all = securityFacts();
        const strip = trustStripFacts(all);
        expect(strip.map((fact) => fact.id)).toEqual([...TRUST_STRIP_FACT_IDS]);
        expect(strip.length).toBeGreaterThan(0);
        expect(strip.length).toBeLessThan(all.length);
        for (const fact of strip) {
            // The very same object: no second wording of a fact exists.
            expect(all).toContain(fact);
        }
        // With nothing passed, the page gets the same facts.
        expect(trustStripFacts()).toEqual(strip);
    });

    it("include the statement that no outside party has assessed the service", () => {
        expect(TRUST_STRIP_FACT_IDS).toContain(INDEPENDENT_ASSESSMENT_FACT_ID);
    });

    it("cannot name a fact the registry does not have", () => {
        expect(() => trustStripFacts(securityFacts(), ["no-such-fact"])).toThrow(
            "Unknown security fact: no-such-fact",
        );
    });
});
