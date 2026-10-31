// SPDX-License-Identifier: AGPL-3.0-only
//
// A playbook run's decisions as its results page holds them: loaded once
// per finished run, then updated from each decision the reviewer records,
// changes or clears, so the cards and the decided-findings counter agree
// without reloading the run.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    acceptMatchingPlaybookFindings,
    clearPlaybookDecision,
    getPlaybookRunDecisions,
    listPlaybookEscalationMembers,
    recordPlaybookDecision,
    type PlaybookDecisionPerson,
    type PlaybookFinding,
    type PlaybookFindingDecision,
    type PlaybookFindingDecisionKind,
    type PlaybookRunDecisions,
} from "@/app/lib/mikeApi";
import { reportFault } from "@/app/lib/userFacingError";
import {
    DECISION_ACTIONS,
    matchedPositionOf,
    type DecisionProgress,
} from "./decisionLabels";

export type DecisionPayload = {
    decision: PlaybookFindingDecisionKind;
    note?: string;
    escalatedTo?: string;
};

export type RunDecisions = {
    status: "idle" | "loading" | "ready" | "error";
    /** The reviewed document's project, which escalation needs. */
    project: PlaybookRunDecisions["project"];
    byFinding: ReadonlyMap<string, PlaybookFindingDecision>;
    retry: () => void;
    decide: (findingId: string, payload: DecisionPayload) => Promise<void>;
    clear: (findingId: string) => Promise<void>;
    acceptMatching: (findingIds: string[]) => Promise<void>;
    loadMembers: () => Promise<PlaybookDecisionPerson[]>;
};

/**
 * The findings a lawyer has to look at: what an issues-only review reports,
 * what the issues view shows, and what the decision counter counts first.
 */
export const ISSUE_STATUSES: ReadonlySet<PlaybookFinding["status"]> = new Set<
    PlaybookFinding["status"]
>(["unacceptable", "missing_required", "needs_review"]);

/** How many of the run's issues, and of all its findings, are decided. */
export function decisionProgress(
    findings: readonly PlaybookFinding[],
    decided: ReadonlyMap<string, unknown>,
): DecisionProgress {
    const issues = findings.filter((finding) =>
        ISSUE_STATUSES.has(finding.status),
    );
    const isDecided = (finding: PlaybookFinding) => decided.has(finding.id);
    return {
        issues: issues.length,
        issuesDecided: issues.filter(isDecided).length,
        findings: findings.length,
        findingsDecided: findings.filter(isDecided).length,
    };
}

/**
 * The findings "Accept matching findings" accepts: acceptable, met the
 * standard position, and not decided yet. A fallback match never is.
 */
export function bulkAcceptableFindings(
    findings: readonly PlaybookFinding[],
    decided: ReadonlyMap<string, unknown>,
): PlaybookFinding[] {
    return findings.filter(
        (finding) =>
            finding.status === "acceptable" &&
            matchedPositionOf(finding) === "standard" &&
            !decided.has(finding.id),
    );
}

type Loaded = {
    runId: string | null;
    status: "loading" | "ready" | "error";
    data: PlaybookRunDecisions | null;
};

/** `runId` is null for a run that has no findings to decide yet. */
export function useRunDecisions(runId: string | null): RunDecisions {
    const [loaded, setLoaded] = useState<Loaded>({
        runId: null,
        status: "loading",
        data: null,
    });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!runId) return;
        let current = true;
        getPlaybookRunDecisions(runId).then(
            (data) => {
                if (current) setLoaded({ runId, status: "ready", data });
            },
            (error) => {
                if (!current) return;
                // Shown inline in place of the counter, with a way to reload.
                reportFault(error, {
                    action: DECISION_ACTIONS.loadDecisions,
                    operation: "playbooks.decide",
                });
                setLoaded({ runId, status: "error", data: null });
            },
        );
        return () => {
            current = false;
        };
    }, [runId, attempt]);

    const data = loaded.runId === runId ? loaded.data : null;
    const status: RunDecisions["status"] = !runId
        ? "idle"
        : loaded.runId === runId
          ? loaded.status
          : "loading";

    /** Applies a change to the run that is still on screen. */
    const update = useCallback(
        (change: (data: PlaybookRunDecisions) => PlaybookRunDecisions) =>
            setLoaded((current) =>
                current.runId === runId && current.data
                    ? { ...current, data: change(current.data) }
                    : current,
            ),
        [runId],
    );

    const retry = useCallback(() => {
        setLoaded({ runId, status: "loading", data: null });
        setAttempt((count) => count + 1);
    }, [runId]);

    const decide = useCallback(
        async (findingId: string, payload: DecisionPayload) => {
            if (!runId) return;
            const saved = await recordPlaybookDecision(runId, findingId, payload);
            update((current) => ({
                ...current,
                decisions: [
                    ...current.decisions.filter(
                        (decision) => decision.findingId !== findingId,
                    ),
                    saved,
                ],
            }));
        },
        [runId, update],
    );

    const clear = useCallback(
        async (findingId: string) => {
            if (!runId) return;
            await clearPlaybookDecision(runId, findingId);
            update((current) => ({
                ...current,
                decisions: current.decisions.filter(
                    (decision) => decision.findingId !== findingId,
                ),
            }));
        },
        [runId, update],
    );

    const acceptMatching = useCallback(
        async (findingIds: string[]) => {
            if (!runId) return;
            const next = await acceptMatchingPlaybookFindings(runId, findingIds);
            update(() => next);
        },
        [runId, update],
    );

    // Members are asked for once per run, when an escalation is first opened.
    const members = useRef<{
        runId: string;
        promise: Promise<PlaybookDecisionPerson[]>;
    } | null>(null);
    const loadMembers = useCallback(() => {
        if (!runId) return Promise.resolve([]);
        if (members.current?.runId !== runId) {
            const promise = listPlaybookEscalationMembers(runId);
            members.current = { runId, promise };
            // A failed load is not kept, so asking again tries again.
            promise.catch(() => {
                if (members.current?.promise === promise) members.current = null;
            });
        }
        return members.current.promise;
    }, [runId]);

    const byFinding = useMemo(
        () =>
            new Map(
                (data?.decisions ?? []).map((decision) => [
                    decision.findingId,
                    decision,
                ]),
            ),
        [data],
    );

    return {
        status,
        project: data?.project ?? null,
        byFinding,
        retry,
        decide,
        clear,
        acceptMatching,
        loadMembers,
    };
}
