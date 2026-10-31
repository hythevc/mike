// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId, useState } from "react";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { downloadBlob } from "@/app/lib/downloadDocument";
import {
    exportPlaybookDecisionRecord,
    type PlaybookRun,
} from "@/app/lib/mikeApi";
import {
    notifyError,
    notifyInfo,
    notifySuccess,
} from "@/app/lib/userFacingError";
import { useLatestRef } from "@/app/hooks/useLatestRef";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import {
    DECISION_ACTIONS,
    DECISION_TEXT,
    bulkConfirmLabel,
    decisionProgressLabel,
    exportSavedMessage,
    saveRecordLabel,
} from "./decisionLabels";
import {
    bulkAcceptableFindings,
    decisionProgress,
    type RunDecisions,
} from "./useRunDecisions";

/**
 * Above a finished run's findings: how many of its issues and findings are
 * decided, accepting the findings that match the standard position together
 * after confirming the list, and exporting the decision record to where its
 * button says it goes.
 */
export function RunDecisionToolbar({
    run,
    decisions,
}: {
    run: PlaybookRun;
    decisions: RunDecisions;
}) {
    const bulkNoneId = useId();
    const [confirming, setConfirming] = useState(false);
    const [accepting, setAccepting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const ready = decisions.status === "ready";
    const matching = bulkAcceptableFindings(run.findings, decisions.byFinding);
    const noneToAccept = ready && matching.length === 0;
    // The record is saved to the project only when the button said so.
    const saveToProject = decisions.project?.canAddDocuments === true;

    async function acceptMatching() {
        const ids = matching.map((finding) => finding.id);
        setConfirming(false);
        setAccepting(true);
        try {
            await decisions.acceptMatching(ids);
        } catch (error) {
            notifyError(error, {
                action: DECISION_ACTIONS.acceptMatching,
                operation: "playbooks.decide",
            });
        } finally {
            setAccepting(false);
        }
    }

    const exportRecord = useLatestRef(async () => {
        setExporting(true);
        try {
            const result = await exportPlaybookDecisionRecord(run.id, {
                saveToProject,
            });
            if (result.kind === "saved") {
                notifySuccess(exportSavedMessage(result.saved.projectName));
                return;
            }
            downloadBlob(result.blob, result.filename);
            // The reviewer's access changed since the page loaded.
            if (saveToProject) notifyInfo(DECISION_TEXT.recordDownloadedInstead);
        } catch (error) {
            notifyError(error, {
                action: DECISION_ACTIONS.exportRecord,
                operation: "playbooks.export",
                onRetry: () => void exportRecord.current(),
            });
        } finally {
            setExporting(false);
        }
    });

    return (
        <div className="space-y-1.5 rounded-xl bg-gray-100 px-3 py-2.5 md:px-4">
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
                            ? decisionProgressLabel(
                                  decisionProgress(run.findings, decisions.byFinding),
                              )
                            : DECISION_TEXT.loadingDecisions}
                    </p>
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        loading={accepting}
                        disabled={!ready || matching.length === 0}
                        aria-describedby={noneToAccept ? bulkNoneId : undefined}
                        onClick={() => setConfirming(true)}
                    >
                        {DECISION_TEXT.bulkAccept}
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        loading={exporting}
                        // Where the record goes is known once decisions load.
                        disabled={decisions.status === "loading"}
                        // A long project name wraps rather than overflowing.
                        className="h-auto min-h-7 max-w-full py-1 text-left leading-snug [overflow-wrap:anywhere]"
                        onClick={() => void exportRecord.current()}
                    >
                        {saveToProject
                            ? saveRecordLabel(decisions.project?.name ?? "")
                            : DECISION_TEXT.downloadRecord}
                    </PillButtonUI>
                </div>
            </div>
            {noneToAccept && (
                // A disabled button cannot be focused, so its reason is text.
                <p id={bulkNoneId} className="text-xs text-gray-500">
                    {DECISION_TEXT.bulkNone}
                </p>
            )}
            <ConfirmPopup
                open={confirming}
                title={DECISION_TEXT.bulkTitle}
                message={
                    <div className="space-y-2">
                        <p>{DECISION_TEXT.bulkMessage}</p>
                        {/* Focusable, so a long list scrolls from the keyboard. */}
                        <ul
                            aria-label={DECISION_TEXT.bulkList}
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
