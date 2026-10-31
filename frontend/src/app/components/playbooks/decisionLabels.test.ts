// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { PlaybookFinding, PlaybookFindingDecision } from "@/app/lib/mikeApi";
import {
    DECISION_TEXT,
    MATCHED_POSITION_LABEL,
    bulkConfirmLabel,
    decisionByline,
    decisionProgressLabel,
    escalateFormLabel,
    escalatedToLabel,
    exportSavedMessage,
    matchedPositionOf,
    overrideFormLabel,
    personName,
    saveRecordLabel,
} from "./decisionLabels";
import { bulkAcceptableFindings, decisionProgress } from "./useRunDecisions";

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

    it("counts the decided issues first, then every finding", () => {
        const progress = (
            issuesDecided: number,
            issues: number,
            findingsDecided: number,
            findings: number,
        ) =>
            decisionProgressLabel({
                issuesDecided,
                issues,
                findingsDecided,
                findings,
            });
        expect(progress(2, 3, 5, 12)).toBe(
            "2 of 3 issues decided, 5 of 12 findings decided",
        );
        expect(progress(0, 1, 0, 4)).toBe(
            "0 of 1 issue decided, 0 of 4 findings decided",
        );
        // Every finding is an issue, as in an issues-only review.
        expect(progress(1, 3, 1, 3)).toBe("1 of 3 issues decided");
        // No issues: only the findings are left to count.
        expect(progress(0, 0, 3, 7)).toBe("3 of 7 findings decided");
        expect(progress(0, 0, 0, 1)).toBe("0 of 1 finding decided");
    });

    it("counts issues as the issues view shows them", () => {
        const findings = [
            finding({ id: "a", status: "unacceptable" }),
            finding({ id: "b", status: "missing_required" }),
            finding({ id: "c", status: "needs_review" }),
            finding({ id: "d", status: "acceptable" }),
            finding({ id: "e", status: "not_applicable" }),
        ];
        expect(
            decisionProgress(findings, new Map([["a", true], ["d", true]])),
        ).toEqual({ issues: 3, issuesDecided: 1, findings: 5, findingsDecided: 2 });
    });

    it("names the bulk confirmation, the forms and where the record goes", () => {
        expect(bulkConfirmLabel(1)).toBe("Accept 1 finding");
        expect(bulkConfirmLabel(4)).toBe("Accept 4 findings");
        expect(overrideFormLabel("Liability cap")).toBe("Override Liability cap");
        expect(escalateFormLabel("Liability cap")).toBe("Escalate Liability cap");
        expect(saveRecordLabel("Acme matter")).toBe(
            "Save decision record to Acme matter",
        );
        expect(saveRecordLabel("")).toBe("Save decision record to the project");
        expect(DECISION_TEXT.downloadRecord).toBe("Download decision record");
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
