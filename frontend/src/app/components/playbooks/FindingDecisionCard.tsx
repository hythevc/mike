// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
    useEffect,
    useId,
    useMemo,
    useState,
    type FormEvent,
    type ReactNode,
} from "react";
import { EditCard } from "@/app/components/assistant/EditCard";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { LIQUID_GLASS_FLAT_CLASS } from "@/app/components/ui/liquid-surface";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import type { EditAnnotation } from "@/app/components/shared/types";
import type {
    PlaybookDecisionPerson,
    PlaybookFinding,
    PlaybookFindingDecision,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { diffWords } from "@/app/lib/wordDiff";
import { cn } from "@/app/lib/utils";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import { TextSlabUI } from "@/shared/ui/TextSlabUI";
import {
    DECISION_TEXT,
    MATCHED_POSITION_LABEL,
    RECOMMENDATION_LABEL,
    decisionByline,
    decisionGroupLabel,
    escalatedToLabel,
    formatDecisionTime,
    matchedPositionOf,
    personName,
} from "./decisionLabels";
import type { DecisionPayload } from "./useRunDecisions";

const STATUS_LABEL: Record<string, string> = {
    unacceptable: "Unacceptable",
    missing_required: "Missing",
    needs_review: "Needs review",
    acceptable: "Acceptable",
    not_applicable: "Not applicable",
    outside_scope: "Outside scope",
};

const STATUS_TONE: Record<string, string> = {
    unacceptable: "text-red-600",
    missing_required: "text-red-600",
    needs_review: "text-amber-700",
    acceptable: "text-green-700",
    not_applicable: "text-gray-500",
    outside_scope: "text-gray-500",
};

/** The tracked changes a run made, decided from its findings. */
export type FindingEditHandlers = {
    resolved: Record<string, "accepted" | "rejected">;
    onViewEdit: (annotation: EditAnnotation) => void;
    onEditResolved: (editId: string, status: "accepted" | "rejected") => void;
};

/** What a card needs to record the reviewer's decision on its finding. */
export type FindingDecisionHandlers = {
    /** False while the run's decisions load, or when they could not. */
    decisionsReady: boolean;
    /** False when the reviewed document is not in a project to escalate in. */
    canEscalate: boolean;
    onDecide: (findingId: string, payload: DecisionPayload) => Promise<void>;
    onClear: (findingId: string) => Promise<void>;
    loadMembers: () => Promise<PlaybookDecisionPerson[]>;
};

/** A labelled part of a finding, so it is clear what each block of text is. */
function FindingPart({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            {children}
        </div>
    );
}

/** The contract language with the recommended edits marked in place. */
function Redline({ before, after }: { before: string; after: string }) {
    const segments = useMemo(() => diffWords(before, after), [before, after]);
    return (
        <p className="whitespace-pre-wrap rounded-lg bg-gray-100 px-3 py-2 text-xs leading-relaxed text-gray-800 [overflow-wrap:anywhere]">
            {segments.map((segment, index) =>
                segment.type === "removed" ? (
                    <del
                        key={index}
                        className="rounded-sm bg-red-50 text-red-700 decoration-red-400"
                    >
                        <span className="sr-only">Removed: </span>
                        {segment.text}
                    </del>
                ) : segment.type === "added" ? (
                    <ins
                        key={index}
                        className="rounded-sm bg-emerald-50 text-emerald-700 no-underline"
                    >
                        <span className="sr-only">Added: </span>
                        {segment.text}
                    </ins>
                ) : (
                    <span key={index}>{segment.text}</span>
                ),
            )}
        </p>
    );
}

/**
 * One finding of a run: the AI's recommendation, the position the clause
 * matched, its reasons and suggested language, and the reviewer's decision
 * on it (accept, override with a note, or escalate to a colleague).
 */
export function FindingDecisionCard({
    finding,
    decision,
    resolved,
    onViewEdit,
    onEditResolved,
    ...decisions
}: {
    finding: PlaybookFinding;
    decision: PlaybookFindingDecision | undefined;
} & FindingEditHandlers &
    FindingDecisionHandlers) {
    const titleId = useId();
    const missing = finding.status === "missing_required";
    return (
        <article
            aria-labelledby={titleId}
            className={`min-w-0 space-y-3 rounded-xl p-3 md:p-4 ${LIQUID_GLASS_FLAT_CLASS}`}
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4
                    id={titleId}
                    className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                >
                    {finding.ruleName}
                </h4>
                <span className={`shrink-0 text-xs ${STATUS_TONE[finding.status]}`}>
                    {STATUS_LABEL[finding.status] ?? finding.status}
                </span>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div className="min-w-0">
                    <dt className="text-xs font-medium text-gray-500">
                        {DECISION_TEXT.recommendation}
                    </dt>
                    <dd className="mt-0.5 text-sm text-gray-700">
                        {RECOMMENDATION_LABEL[finding.status] ?? finding.status}
                    </dd>
                </div>
                <div className="min-w-0">
                    <dt className="text-xs font-medium text-gray-500">
                        {DECISION_TEXT.matchedPosition}
                    </dt>
                    <dd className="mt-0.5 text-sm text-gray-700">
                        {MATCHED_POSITION_LABEL[matchedPositionOf(finding)]}
                    </dd>
                </div>
            </dl>
            {finding.location && (
                <FindingPart label="Where">
                    <p className="text-sm text-gray-700 [overflow-wrap:anywhere]">
                        {finding.location}
                    </p>
                </FindingPart>
            )}
            {finding.analysis && (
                <FindingPart label={DECISION_TEXT.reasons}>
                    <p className="text-sm leading-relaxed text-gray-700">
                        {finding.analysis}
                    </p>
                </FindingPart>
            )}
            {/* With a suggestion, the diff shows the contract language too. */}
            {finding.quote && !finding.suggestedText && (
                <FindingPart label="Contract language">
                    <TextSlabUI className="text-xs text-gray-600">
                        <blockquote>{finding.quote}</blockquote>
                    </TextSlabUI>
                </FindingPart>
            )}
            {finding.edit ? (
                // The change is in the document as a tracked change: decide it here.
                <FindingPart
                    label={missing ? "Recommended clause to add" : "Recommended change"}
                >
                    <EditCard
                        annotation={finding.edit}
                        resolvedStatus={resolved[finding.edit.edit_id]}
                        onViewClick={onViewEdit}
                        onResolved={({ editId, status }) =>
                            onEditResolved(editId, status)
                        }
                    />
                </FindingPart>
            ) : (
                finding.suggestedText && (
                    <FindingPart
                        label={
                            missing || !finding.quote
                                ? "Recommended clause to add"
                                : "Recommended changes"
                        }
                    >
                        <Redline
                            before={missing ? "" : finding.quote}
                            after={finding.suggestedText}
                        />
                    </FindingPart>
                )
            )}
            <DecisionPanel finding={finding} decision={decision} {...decisions} />
        </article>
    );
}

type Mode = "view" | "choose" | "override" | "escalate";

/** The reviewer's decision on one finding, and the controls to make it. */
function DecisionPanel({
    finding,
    decision,
    decisionsReady,
    canEscalate,
    onDecide,
    onClear,
    loadMembers,
}: {
    finding: PlaybookFinding;
    decision: PlaybookFindingDecision | undefined;
} & FindingDecisionHandlers) {
    const [mode, setMode] = useState<Mode>("view");
    const [busy, setBusy] = useState(false);
    const groupLabel = decisionGroupLabel(finding.ruleName);
    const shown: Mode = mode === "view" && !decision ? "choose" : mode;

    if (!decisionsReady)
        return (
            <div aria-hidden="true" className="pt-1">
                <SkeletonLine className="w-1/3" />
            </div>
        );

    async function save(payload: DecisionPayload) {
        setBusy(true);
        try {
            await onDecide(finding.id, payload);
            setMode("view");
            return true;
        } catch (error) {
            notifyError(error, {
                action: "record the decision",
                operation: "playbooks.decide",
            });
            return false;
        } finally {
            setBusy(false);
        }
    }

    async function clear() {
        setBusy(true);
        try {
            await onClear(finding.id);
            setMode("view");
        } catch (error) {
            notifyError(error, {
                action: "clear the decision",
                operation: "playbooks.decide",
            });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            role="group"
            aria-label={groupLabel}
            className="min-w-0 space-y-2 border-t border-gray-200/70 pt-3"
        >
            <p className="text-xs font-medium text-gray-500">
                {DECISION_TEXT.yourDecision}
            </p>
            {shown === "view" && decision ? (
                <DecisionSummary
                    decision={decision}
                    ruleName={finding.ruleName}
                    onChange={() => setMode("choose")}
                />
            ) : shown === "override" ? (
                <OverrideForm
                    ruleName={finding.ruleName}
                    busy={busy}
                    initialNote={
                        decision?.decision === "overridden" ? (decision.note ?? "") : ""
                    }
                    onCancel={() => setMode(decision ? "view" : "choose")}
                    onSave={(note) => save({ decision: "overridden", note })}
                />
            ) : shown === "escalate" ? (
                <EscalateForm
                    ruleName={finding.ruleName}
                    busy={busy}
                    canEscalate={canEscalate}
                    loadMembers={loadMembers}
                    onCancel={() => setMode(decision ? "view" : "choose")}
                    onSave={(escalatedTo, note) =>
                        save({ decision: "escalated", escalatedTo, note })
                    }
                />
            ) : (
                <div className="flex flex-wrap items-center gap-2">
                    <PillButtonUI
                        tone="black"
                        size="sm"
                        loading={busy}
                        onClick={() => void save({ decision: "accepted" })}
                    >
                        {DECISION_TEXT.accept}
                        <span className="sr-only">: {finding.ruleName}</span>
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        disabled={busy}
                        onClick={() => setMode("override")}
                    >
                        {DECISION_TEXT.override}
                        <span className="sr-only">: {finding.ruleName}</span>
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        disabled={busy}
                        onClick={() => setMode("escalate")}
                    >
                        {DECISION_TEXT.escalate}
                        <span className="sr-only">: {finding.ruleName}</span>
                    </PillButtonUI>
                    {decision && (
                        <>
                            <TextButtonUI
                                size="xs"
                                disabled={busy}
                                onClick={() => void clear()}
                            >
                                {DECISION_TEXT.clear}
                                <span className="sr-only">: {finding.ruleName}</span>
                            </TextButtonUI>
                            <TextButtonUI
                                size="xs"
                                disabled={busy}
                                onClick={() => setMode("view")}
                            >
                                {DECISION_TEXT.cancel}
                            </TextButtonUI>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function DecisionSummary({
    decision,
    ruleName,
    onChange,
}: {
    decision: PlaybookFindingDecision;
    ruleName: string;
    onChange: () => void;
}) {
    return (
        <div className="space-y-1.5">
            <p className="text-sm text-gray-900 [overflow-wrap:anywhere]">
                {decisionByline(decision)}
            </p>
            <p className="text-xs text-gray-500">
                <time dateTime={decision.decidedAt}>
                    {formatDecisionTime(decision.decidedAt)}
                </time>
            </p>
            {decision.decision === "escalated" && (
                <p className="text-sm text-gray-700 [overflow-wrap:anywhere]">
                    {escalatedToLabel(decision.escalatedTo)}
                </p>
            )}
            {decision.note && (
                <FindingPart label={DECISION_TEXT.note}>
                    <p className="whitespace-pre-wrap text-sm text-gray-700 [overflow-wrap:anywhere]">
                        {decision.note}
                    </p>
                </FindingPart>
            )}
            <TextButtonUI size="xs" className="-ml-1" onClick={onChange}>
                {DECISION_TEXT.change}
                <span className="sr-only">: {ruleName}</span>
            </TextButtonUI>
        </div>
    );
}

function FormActions({
    busy,
    submitLabel,
    submitDisabled = false,
    onCancel,
}: {
    busy: boolean;
    submitLabel: string;
    submitDisabled?: boolean;
    onCancel: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <PillButtonUI
                tone="black"
                size="sm"
                type="submit"
                loading={busy}
                disabled={submitDisabled}
            >
                {submitLabel}
            </PillButtonUI>
            <TextButtonUI size="xs" disabled={busy} onClick={onCancel}>
                {DECISION_TEXT.cancel}
            </TextButtonUI>
        </div>
    );
}

function OverrideForm({
    ruleName,
    busy,
    initialNote,
    onCancel,
    onSave,
}: {
    ruleName: string;
    busy: boolean;
    initialNote: string;
    onCancel: () => void;
    onSave: (note: string) => Promise<boolean>;
}) {
    const noteId = useId();
    const errorId = useId();
    const [note, setNote] = useState(initialNote);
    const [missingNote, setMissingNote] = useState(false);

    function submit(event: FormEvent) {
        event.preventDefault();
        if (!note.trim()) {
            setMissingNote(true);
            return;
        }
        void onSave(note.trim());
    }

    return (
        <form
            noValidate
            aria-label={`Override ${ruleName}`}
            onSubmit={submit}
            className="space-y-2"
        >
            <label htmlFor={noteId} className="block text-xs font-medium text-gray-700">
                {DECISION_TEXT.overrideNote}
            </label>
            <ModalTextarea
                id={noteId}
                value={note}
                required
                maxLength={4000}
                aria-invalid={missingNote || undefined}
                aria-describedby={missingNote ? errorId : undefined}
                onChange={(event) => {
                    setNote(event.target.value);
                    if (event.target.value.trim()) setMissingNote(false);
                }}
                className="min-h-20 text-sm"
            />
            {missingNote && (
                <p id={errorId} role="alert" className="text-xs text-red-600">
                    {DECISION_TEXT.overrideNoteRequired}
                </p>
            )}
            <FormActions
                busy={busy}
                submitLabel={DECISION_TEXT.saveOverride}
                onCancel={onCancel}
            />
        </form>
    );
}

type MembersState =
    | { status: "loading" }
    | { status: "ready"; members: PlaybookDecisionPerson[] }
    | { status: "error" };

function EscalateForm({
    ruleName,
    busy,
    canEscalate,
    loadMembers,
    onCancel,
    onSave,
}: {
    ruleName: string;
    busy: boolean;
    canEscalate: boolean;
    loadMembers: () => Promise<PlaybookDecisionPerson[]>;
    onCancel: () => void;
    onSave: (escalatedTo: string, note: string | undefined) => Promise<boolean>;
}) {
    const memberId = useId();
    const noteId = useId();
    const [members, setMembers] = useState<MembersState>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [colleague, setColleague] = useState("");
    const [note, setNote] = useState("");

    // Asked for once the form is open; a project's roster is not needed before.
    useEffect(() => {
        if (!canEscalate) return;
        let current = true;
        loadMembers().then(
            (list) => {
                if (current) setMembers({ status: "ready", members: list });
            },
            () => {
                // Shown in the form with Try again; the API client has
                // already reported a server fault.
                if (current) setMembers({ status: "error" });
            },
        );
        return () => {
            current = false;
        };
    }, [canEscalate, loadMembers, attempt]);

    function submit(event: FormEvent) {
        event.preventDefault();
        if (!colleague) return;
        void onSave(colleague, note.trim() || undefined);
    }

    if (!canEscalate)
        return (
            <div className="space-y-2">
                <p className="text-sm text-gray-700">{DECISION_TEXT.noProject}</p>
                <TextButtonUI size="xs" className="-ml-1" onClick={onCancel}>
                    {DECISION_TEXT.cancel}
                </TextButtonUI>
            </div>
        );

    return (
        <form
            noValidate
            aria-label={`Escalate ${ruleName}`}
            onSubmit={submit}
            className="space-y-2"
        >
            {members.status === "loading" ? (
                <p role="status" className="text-sm text-gray-500">
                    {DECISION_TEXT.loadingMembers}
                </p>
            ) : members.status === "error" ? (
                <p role="alert" className="text-sm text-red-600">
                    {DECISION_TEXT.membersUnavailable}{" "}
                    <button
                        type="button"
                        onClick={() => {
                            setMembers({ status: "loading" });
                            setAttempt((count) => count + 1);
                        }}
                        className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                        {DECISION_TEXT.tryAgain}
                    </button>
                </p>
            ) : members.members.length === 0 ? (
                <p className="text-sm text-gray-700">{DECISION_TEXT.noMembers}</p>
            ) : (
                <>
                    <label
                        htmlFor={memberId}
                        className="block text-xs font-medium text-gray-700"
                    >
                        {DECISION_TEXT.escalateTo}
                    </label>
                    <select
                        id={memberId}
                        value={colleague}
                        required
                        onChange={(event) => setColleague(event.target.value)}
                        className={cn(FORM_CONTROL_GLASS_CLASS, "h-10")}
                    >
                        <option value="">{DECISION_TEXT.chooseColleague}</option>
                        {members.members.map((member) => (
                            <option key={member.userId} value={member.userId}>
                                {member.displayName && member.email
                                    ? `${personName(member)} (${member.email})`
                                    : personName(member)}
                            </option>
                        ))}
                    </select>
                    <label
                        htmlFor={noteId}
                        className="block text-xs font-medium text-gray-700"
                    >
                        {DECISION_TEXT.escalationNote}
                    </label>
                    <ModalTextarea
                        id={noteId}
                        value={note}
                        maxLength={4000}
                        onChange={(event) => setNote(event.target.value)}
                        className="min-h-16 text-sm"
                    />
                </>
            )}
            <FormActions
                busy={busy}
                submitLabel={DECISION_TEXT.saveEscalation}
                submitDisabled={members.status !== "ready" || !colleague}
                onCancel={onCancel}
            />
        </form>
    );
}
