// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { PlaybookFinding, PlaybookFindingDecision } from "@/app/lib/mikeApi";
import {
    DECISION_TEXT,
    MATCHED_POSITION_LABEL,
    bulkConfirmLabel,
    decidedCountLabel,
    decisionByline,
    escalatedToLabel,
    exportSavedMessage,
    matchedPositionOf,
    personName,
} from "./decisionLabels";
import { bulkAcceptableFindings } from "./useRunDecisions";

function finding(overrides: Partial<PlaybookFinding>): PlaybookFinding {
    return {
        id: "f",
        topicId: null,
        ruleId: "r",
        ruleName: "Rule",
        status: "acceptable",
        quote: "",
        location: "",
        analysis: "",
        suggestedText: "",
        ...overrides,
    };
}

const jane = { userId: "u", displayName: "Jane Doe", email: "jane@example.com" };

function decision(
    overrides: Partial<PlaybookFindingDecision> = {},
): PlaybookFindingDecision {
    return {
        findingId: "f",
        decision: "accepted",
        method: "single",
        note: null,
        escalatedTo: null,
        decidedBy: jane,
        decidedAt: "2026-10-31T10:02:00.000Z",
        ...overrides,
    };
}

describe("decision labels", () => {
    it("reads a finding without a matched position as none", () => {
        expect(matchedPositionOf(finding({}))).toBe("none");
        expect(matchedPositionOf(finding({ matchedPosition: "fallback" }))).toBe(
            "fallback",
        );
        expect(MATCHED_POSITION_LABEL[matchedPositionOf(finding({}))]).toBe("None");
    });

    it("counts decided findings and names the bulk confirmation", () => {
        expect(decidedCountLabel(0, 1)).toBe("0 of 1 finding decided");
        expect(decidedCountLabel(3, 7)).toBe("3 of 7 findings decided");
        expect(bulkConfirmLabel(1)).toBe("Accept 1 finding");
        expect(bulkConfirmLabel(4)).toBe("Accept 4 findings");
    });

    it("says who decided and how, without inventing a name", () => {
        expect(decisionByline(decision())).toBe("Accepted by Jane Doe");
        expect(decisionByline(decision({ method: "bulk" }))).toBe(
            "Accepted by Jane Doe, in bulk",
        );
        expect(
            decisionByline(decision({ decision: "overridden", decidedBy: null })),
        ).toBe("Overridden by Deleted account");
        expect(personName({ userId: "u", displayName: null, email: "a@b.co" })).toBe(
            "a@b.co",
        );
        expect(escalatedToLabel(jane)).toBe("Escalated to Jane Doe");
        expect(exportSavedMessage("Acme matter")).toBe(
            "Decision record saved to Acme matter.",
        );
    });

    it("keeps the AI-draft line and the disclaimer together", () => {
        expect(DECISION_TEXT.aiDraftNotice).toContain("AI-generated draft");
        expect(DECISION_TEXT.aiDraftNotice).toContain(
            "Legal information, not legal advice.",
        );
    });
});

describe("findings accepted together", () => {
    const findings = [
        finding({ id: "standard", matchedPosition: "standard" }),
        finding({ id: "fallback", matchedPosition: "fallback" }),
        finding({ id: "older" }),
        finding({ id: "review", status: "needs_review", matchedPosition: "standard" }),
        finding({ id: "issue", status: "unacceptable", matchedPosition: "none" }),
        finding({ id: "decided", matchedPosition: "standard" }),
    ];

    it("are the undecided acceptable findings that met the standard position", () => {
        expect(
            bulkAcceptableFindings(findings, new Map([["decided", true]])).map(
                (item) => item.id,
            ),
        ).toEqual(["standard"]);
    });
});
