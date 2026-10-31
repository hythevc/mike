// SPDX-License-Identifier: AGPL-3.0-only
//
// The words the playbook decision cards use, in one list so they can be
// reviewed together. The decision record the backend exports as a Word
// document (playbooks.summaryExport.ts) uses the same words for matched
// positions, decisions and methods.

import type {
    PlaybookDecisionPerson,
    PlaybookFinding,
    PlaybookFindingDecision,
    PlaybookFindingDecisionKind,
    PlaybookFindingDecisionMethod,
    PlaybookMatchedPosition,
} from "@/app/lib/mikeApi";

export const MATCHED_POSITION_LABEL: Record<PlaybookMatchedPosition, string> = {
    standard: "Standard",
    fallback: "Fallback",
    none: "None",
};

/** A finding recorded before findings had a matched position reads as none. */
export function matchedPositionOf(
    finding: Pick<PlaybookFinding, "matchedPosition">,
): PlaybookMatchedPosition {
    return finding.matchedPosition === "standard" ||
        finding.matchedPosition === "fallback"
        ? finding.matchedPosition
        : "none";
}

/** What the AI recommends doing about the clause, from its finding's status. */
export const RECOMMENDATION_LABEL: Record<PlaybookFinding["status"], string> = {
    acceptable: "Accept as drafted",
    needs_review: "Check before accepting",
    unacceptable: "Revise to meet the playbook",
    missing_required: "Add the required clause",
    not_applicable: "No change needed",
    outside_scope: "Check: not covered by the playbook",
};

export const DECISION_LABEL: Record<PlaybookFindingDecisionKind, string> = {
    accepted: "Accepted",
    overridden: "Overridden",
    escalated: "Escalated",
};

export const METHOD_LABEL: Record<PlaybookFindingDecisionMethod, string> = {
    single: "Individually",
    bulk: "In bulk",
};

export const DECISION_TEXT = {
    recommendation: "AI recommendation",
    matchedPosition: "Matched position",
    reasons: "Assessment",
    yourDecision: "Your decision",
    accept: "Accept finding",
    override: "Override",
    escalate: "Escalate",
    change: "Change decision",
    clear: "Clear decision",
    cancel: "Cancel",
    saveOverride: "Save override",
    saveEscalation: "Escalate finding",
    overrideNote: "Why are you overriding this finding?",
    overrideNoteRequired:
        "Add a note saying why you are overriding this finding.",
    escalateTo: "Escalate to",
    chooseColleague: "Choose a colleague",
    escalationNote: "Note for your colleague (optional)",
    loadingMembers: "Loading the project's members…",
    membersUnavailable: "The project's members could not be loaded.",
    noMembers: "No one else can open the reviewed document's project.",
    noProject:
        "Escalation goes to a member of the project the reviewed document is in. This review's document is not in a project you can open.",
    note: "Note",
    loadingDecisions: "Loading decisions…",
    decisionsUnavailable: "Decisions could not be loaded.",
    reloadDecisions: "Reload decisions",
    tryAgain: "Try again",
    aiDraftNotice:
        "AI-generated draft for a lawyer to decide on. Legal information, not legal advice.",
    bulkAccept: "Accept matching findings",
    bulkTitle: "Accept matching findings?",
    bulkMessage:
        "These findings are acceptable and meet the standard position. Each is recorded as accepted in bulk, under your name.",
    bulkNone: "No undecided findings meet the standard position.",
    exportRecord: "Export decision record",
} as const;

/** "Decision on Liability cap": names a finding's decision controls. */
export function decisionGroupLabel(ruleName: string): string {
    return `Decision on ${ruleName}`;
}

/** "Accept 2 findings": the confirmation's button. */
export function bulkConfirmLabel(count: number): string {
    return `Accept ${count} ${count === 1 ? "finding" : "findings"}`;
}

/** "3 of 7 findings decided": the run's decision counter. */
export function decidedCountLabel(decided: number, total: number): string {
    return `${decided} of ${total} ${total === 1 ? "finding" : "findings"} decided`;
}

export function exportSavedMessage(projectName: string): string {
    return projectName
        ? `Decision record saved to ${projectName}.`
        : "Decision record saved to the project.";
}

/** A person's name as a decision shows it; null once their account is gone. */
export function personName(person: PlaybookDecisionPerson | null): string {
    return (
        person?.displayName?.trim() ||
        person?.email?.trim() ||
        "Deleted account"
    );
}

export function escalatedToLabel(person: PlaybookDecisionPerson | null): string {
    return `Escalated to ${personName(person)}`;
}

export function formatDecisionTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

/** "Accepted by Jane Doe, in bulk": who decided and how. */
export function decisionByline(decision: PlaybookFindingDecision): string {
    const who = `${DECISION_LABEL[decision.decision]} by ${personName(decision.decidedBy)}`;
    return decision.method === "bulk"
        ? `${who}, ${METHOD_LABEL.bulk.toLowerCase()}`
        : who;
}
