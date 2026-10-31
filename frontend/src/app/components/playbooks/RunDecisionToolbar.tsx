// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { downloadBlob } from "@/app/lib/downloadDocument";
import {
    exportPlaybookDecisionRecord,
    type PlaybookRun,
} from "@/app/lib/mikeApi";
import { notifyError, notifySuccess } from "@/app/lib/userFacingError";
import { useLatestRef } from "@/app/hooks/useLatestRef";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import {
    DECISION_TEXT,
    bulkConfirmLabel,
    decidedCountLabel,
    exportSavedMessage,
} from "./decisionLabels";
import { bulkAcceptableFindings, type RunDecisions } from "./useRunDecisions";

/**
 * Above a finished run's findings: how many are decided, accepting the
 * findings that match the standard position together after confirming the
 * list, and exporting the decision record.
 */
export function RunDecisionToolbar({
    run,
    decisions,
}: {
    run: PlaybookRun;
    decisions: RunDecisions;
}) {
    const [confirming, setConfirming] = useState(false);
    const [accepting, setAccepting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const ready = decisions.status === "ready";
    const total = run.findings.length;
    const decided = run.findings.filter((finding) =>
        decisions.byFinding.has(finding.id),
    ).length;
    const matching = bulkAcceptableFindings(run.findings, decisions.byFinding);

    async function acceptMatching() {
        const ids = matching.map((finding) => finding.id);
        setConfirming(false);
        setAccepting(true);
        try {
            await decisions.acceptMatching(ids);
        } catch (error) {
            notifyError(error, {
                action: "accept the matching findings",
                operation: "playbooks.decide",
            });
        } finally {
            setAccepting(false);
        }
    }

    const exportRecord = useLatestRef(async () => {
        setExporting(true);
        try {
            const result = await exportPlaybookDecisionRecord(run.id);
            if (result.kind === "saved")
                notifySuccess(exportSavedMessage(result.saved.projectName));
            else downloadBlob(result.blob, result.filename);
        } catch (error) {
            notifyError(error, {
                action: "export the decision record",
                operation: "playbooks.export",
                onRetry: () => void exportRecord.current(),
            });
        } finally {
            setExporting(false);
        }
    });

    return (
        <div className="rounded-xl bg-gray-100 px-3 py-2.5 md:px-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                {decisions.status === "error" ? (
                    <p role="alert" className="text-xs text-red-600">
                        {DECISION_TEXT.decisionsUnavailable}{" "}
                        <button
                            type="button"
                            onClick={decisions.retry}
                            className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                        >
                            {DECISION_TEXT.reloadDecisions}
                        </button>
                    </p>
                ) : (
                    <p
                        role="status"
                        aria-live="polite"
                        className="text-sm text-gray-900"
                    >
                        {ready
                            ? decidedCountLabel(decided, total)
                            : DECISION_TEXT.loadingDecisions}
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        loading={accepting}
                        disabled={!ready || matching.length === 0}
                        title={
                            ready && matching.length === 0
                                ? DECISION_TEXT.bulkNone
                                : undefined
                        }
                        onClick={() => setConfirming(true)}
                    >
                        {DECISION_TEXT.bulkAccept}
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        loading={exporting}
                        onClick={() => void exportRecord.current()}
                    >
                        {DECISION_TEXT.exportRecord}
                    </PillButtonUI>
                </div>
            </div>
            <ConfirmPopup
                open={confirming}
                title={DECISION_TEXT.bulkTitle}
                message={
                    <div className="space-y-2">
                        <p>{DECISION_TEXT.bulkMessage}</p>
                        {/* Focusable, so a long list scrolls from the keyboard. */}
                        <ul
                            aria-label="Findings to accept"
                            tabIndex={0}
                            className="max-h-48 list-disc space-y-0.5 overflow-y-auto rounded-md pl-4 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                        >
                            {matching.map((finding) => (
                                <li key={finding.id} className="[overflow-wrap:anywhere]">
                                    {finding.ruleName}
                                </li>
                            ))}
                        </ul>
                    </div>
                }
                confirmLabel={bulkConfirmLabel(matching.length)}
                confirmDisabled={matching.length === 0}
                onConfirm={() => void acceptMatching()}
                onCancel={() => setConfirming(false)}
            />
        </div>
    );
}
