// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type ReactNode,
} from "react";
import { EditCard } from "@/app/components/assistant/EditCard";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
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
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import { TextSlabUI } from "@/shared/ui/TextSlabUI";
import {
    DECISION_ACTIONS,
    DECISION_TEXT,
    MATCHED_POSITION_LABEL,
    RECOMMENDATION_LABEL,
    decisionByline,
    decisionGroupLabel,
    escalateFormLabel,
    escalatedToLabel,
    formatDecisionTime,
    matchedPositionOf,
    overrideFormLabel,
    personName,
} from "./decisionLabels";
import type { DecisionPayload, RunDecisions } from "./useRunDecisions";

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
    /**
     * Where the run's decisions are: "idle" for a run whose findings cannot
     * be decided, which shows no decision controls at all.
     */
    decisionsStatus: RunDecisions["status"];
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

/**
 * A control focus can be sent to, named by its `data-decision-focus`
 * attribute.
 */
type FocusTarget =
    | "accept"
    | "override"
    | "escalate"
    | "change"
    | "clear"
    | "submit";

const PANEL_CLASS = "min-w-0 space-y-2 border-t border-gray-200/70 pt-3";

/**
 * Whether focus may be moved without taking it from where the reviewer put
 * it: it has been lost to the page (the control that had it was removed),
 * or it is still on `previous`, the element that last had it on purpose.
 */
function focusIsFree(previous: Element | null): boolean {
    const active = document.activeElement;
    return (
        !active ||
        active === document.body ||
        (previous !== null && active === previous)
    );
}

/** The decision panel's shape while the run's decisions load. */
function DecisionPanelSkeleton() {
    return (
        <div aria-hidden="true" className={PANEL_CLASS}>
            <div className="flex h-4 items-center">
                <SkeletonLine className="w-20" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {["w-28", "w-20", "w-20"].map((width, index) => (
                    <SkeletonLine
                        key={index}
                        className={`h-7 rounded-full ${width}`}
                    />
                ))}
            </div>
        </div>
    );
}

/** The reviewer's decision on one finding, and the controls to make it. */
function DecisionPanel({
    finding,
    decision,
    decisionsStatus,
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
    const panel = useRef<HTMLDivElement>(null);
    // Every action replaces or disables the control that started it. Once
    // the panel has drawn the result, focus goes to the control that takes
    // its place: Change decision after a decision is recorded, Accept
    // finding after one is cleared, the opening button after a form is
    // cancelled, or the same control again after a failure.
    const focusNext = useRef<{
        target: FocusTarget;
        from: Element | null;
    } | null>(null);
    useEffect(() => {
        const next = focusNext.current;
        if (!next) return;
        focusNext.current = null;
        const container = panel.current;
        if (!container || !focusIsFree(next.from)) return;
        (
            container.querySelector<HTMLElement>(
                `[data-decision-focus="${next.target}"]`,
            ) ?? container
        ).focus();
    });

    const groupLabel = decisionGroupLabel(finding.ruleName);
    const shown: Mode = mode === "view" && !decision ? "choose" : mode;

    // A run whose findings cannot be decided shows no decision at all.
    if (decisionsStatus === "idle") return null;
    if (decisionsStatus === "loading") return <DecisionPanelSkeleton />;
    if (decisionsStatus === "error")
        // The toolbar says why, with a way to reload; this keeps the card's
        // shape without pulsing as if it were still loading.
        return (
            <div className={PANEL_CLASS}>
                <p className="text-xs font-medium text-gray-500">
                    {DECISION_TEXT.yourDecision}
                </p>
                <p className="text-sm text-gray-500">
                    {DECISION_TEXT.decisionNotLoaded}
                </p>
            </div>
        );

    /** Shows `next`, then sends focus to `target` once it is drawn. */
    function show(next: Mode, target?: FocusTarget) {
        focusNext.current = target
            ? { target, from: document.activeElement }
            : null;
        setMode(next);
    }

    async function save(payload: DecisionPayload, retryFrom: FocusTarget) {
        const from = document.activeElement;
        setBusy(true);
        try {
            await onDecide(finding.id, payload);
            focusNext.current = { target: "change", from };
            setMode("view");
            return true;
        } catch (error) {
            notifyError(error, {
                action: DECISION_ACTIONS.decide,
                operation: "playbooks.decide",
            });
            focusNext.current = { target: retryFrom, from };
            return false;
        } finally {
            setBusy(false);
        }
    }

    async function clear() {
        const from = document.activeElement;
        setBusy(true);
        try {
            await onClear(finding.id);
            focusNext.current = { target: "accept", from };
            setMode("view");
        } catch (error) {
            notifyError(error, {
                action: DECISION_ACTIONS.clear,
                operation: "playbooks.decide",
            });
            focusNext.current = { target: "clear", from };
        } finally {
            setBusy(false);
        }
    }

    // A form cancelled goes back to what opened it.
    function cancelForm(opener: FocusTarget) {
        if (decision) show("view", "change");
        else show("choose", opener);
    }

    return (
        <div
            ref={panel}
            role="group"
            aria-label={groupLabel}
            // Focus lands here only when the control meant to take it is gone.
            tabIndex={-1}
            className={`${PANEL_CLASS} rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40`}
        >
            <p className="text-xs font-medium text-gray-500">
                {DECISION_TEXT.yourDecision}
            </p>
            {shown === "view" && decision ? (
                <DecisionSummary
                    decision={decision}
                    ruleName={finding.ruleName}
                    onChange={() => show("choose", "accept")}
                />
            ) : shown === "override" ? (
                <OverrideForm
                    ruleName={finding.ruleName}
                    busy={busy}
                    initialNote={
                        decision?.decision === "overridden" ? (decision.note ?? "") : ""
                    }
                    onCancel={() => cancelForm("override")}
                    onSave={(note) =>
                        save({ decision: "overridden", note }, "submit")
                    }
                />
            ) : shown === "escalate" ? (
                <EscalateForm
                    ruleName={finding.ruleName}
                    busy={busy}
                    canEscalate={canEscalate}
                    loadMembers={loadMembers}
                    onCancel={() => cancelForm("escalate")}
                    onSave={(escalatedTo, note) =>
                        save({ decision: "escalated", escalatedTo, note }, "submit")
                    }
                />
            ) : (
                <div className="flex flex-wrap items-center gap-2">
                    <PillButtonUI
                        tone="black"
                        size="sm"
                        loading={busy}
                        data-decision-focus="accept"
                        onClick={() => void save({ decision: "accepted" }, "accept")}
                    >
                        {DECISION_TEXT.accept}
                        <span className="sr-only">: {finding.ruleName}</span>
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        disabled={busy}
                        data-decision-focus="override"
                        onClick={() => show("override")}
                    >
                        {DECISION_TEXT.override}
                        <span className="sr-only">: {finding.ruleName}</span>
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        disabled={busy}
                        data-decision-focus="escalate"
                        onClick={() => show("escalate")}
                    >
                        {DECISION_TEXT.escalate}
                        <span className="sr-only">: {finding.ruleName}</span>
                    </PillButtonUI>
                    {decision && (
                        <>
                            <TextButtonUI
                                size="xs"
                                disabled={busy}
                                data-decision-focus="clear"
                                onClick={() => void clear()}
                            >
                                {DECISION_TEXT.clear}
                                <span className="sr-only">: {finding.ruleName}</span>
                            </TextButtonUI>
                            <TextButtonUI
                                size="xs"
                                disabled={busy}
                                onClick={() => show("view", "change")}
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
    const bylineId = useId();
    const escalatedId = useId();
    const escalated = decision.decision === "escalated";
    return (
        <div className="space-y-1.5">
            <p id={bylineId} className="text-sm text-gray-900 [overflow-wrap:anywhere]">
                {decisionByline(decision)}
            </p>
            <p className="text-xs text-gray-500">
                <time dateTime={decision.decidedAt}>
                    {formatDecisionTime(decision.decidedAt)}
                </time>
            </p>
            {escalated && (
                <p
                    id={escalatedId}
                    className="text-sm text-gray-700 [overflow-wrap:anywhere]"
                >
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
            <TextButtonUI
                size="xs"
                className="-ml-1"
                data-decision-focus="change"
                // Focus lands here once a decision is saved: say what it is.
                aria-describedby={escalated ? `${bylineId} ${escalatedId}` : bylineId}
                onClick={onChange}
            >
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
                data-decision-focus="submit"
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
    const noteRef = useRef<HTMLTextAreaElement>(null);
    const [note, setNote] = useState(initialNote);
    const [missingNote, setMissingNote] = useState(false);

    // The form opens in place of the button that asked for it.
    useEffect(() => {
        noteRef.current?.focus();
    }, []);

    function submit(event: FormEvent) {
        event.preventDefault();
        if (!note.trim()) {
            setMissingNote(true);
            noteRef.current?.focus();
            return;
        }
        void onSave(note.trim());
    }

    return (
        <form
            noValidate
            aria-label={overrideFormLabel(ruleName)}
            onSubmit={submit}
            className="space-y-2"
        >
            <label htmlFor={noteId} className="block text-xs font-medium text-gray-700">
                {DECISION_TEXT.overrideNote}
            </label>
            <ModalTextarea
                ref={noteRef}
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

/** Why a finding of this run cannot be escalated, in place of the form. */
function EscalationUnavailable({ onCancel }: { onCancel: () => void }) {
    const message = useRef<HTMLParagraphElement>(null);
    // The reason is read out where the form would have opened.
    useEffect(() => {
        message.current?.focus();
    }, []);
    return (
        <div className="space-y-2">
            <p
                ref={message}
                tabIndex={-1}
                className="rounded-sm text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
                {DECISION_TEXT.noProject}
            </p>
            <TextButtonUI size="xs" className="-ml-1" onClick={onCancel}>
                {DECISION_TEXT.cancel}
            </TextButtonUI>
        </div>
    );
}

function EscalateForm({
    ruleName,
    busy,
    canEscalate,
    ...props
}: {
    ruleName: string;
    busy: boolean;
    canEscalate: boolean;
    loadMembers: () => Promise<PlaybookDecisionPerson[]>;
    onCancel: () => void;
    onSave: (escalatedTo: string, note: string | undefined) => Promise<boolean>;
}) {
    if (!canEscalate) return <EscalationUnavailable onCancel={props.onCancel} />;
    return <EscalateMemberForm ruleName={ruleName} busy={busy} {...props} />;
}

function EscalateMemberForm({
    ruleName,
    busy,
    loadMembers,
    onCancel,
    onSave,
}: {
    ruleName: string;
    busy: boolean;
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
    const messageRef = useRef<HTMLParagraphElement>(null);
    const retryRef = useRef<HTMLButtonElement>(null);
    const selectWrap = useRef<HTMLDivElement>(null);
    // What this form last sent focus to, so a later step moves it on only
    // while the reviewer has left it there.
    const focused = useRef<Element | null>(null);

    // Asked for once the form is open; a project's roster is not needed before.
    useEffect(() => {
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
    }, [loadMembers, attempt]);

    const choosing = members.status === "ready" && members.members.length > 0;
    // Each step of opening the form replaces what had focus: the status
    // line while the members load, then the colleague list, or the message
    // or Try again that takes its place.
    useEffect(() => {
        if (!focusIsFree(focused.current)) return;
        const target =
            members.status === "error"
                ? retryRef.current
                : choosing
                  ? selectWrap.current?.querySelector<HTMLElement>("button")
                  : messageRef.current;
        target?.focus();
        focused.current = target ?? null;
    }, [members.status, choosing]);

    function submit(event: FormEvent) {
        event.preventDefault();
        if (!colleague) return;
        void onSave(colleague, note.trim() || undefined);
    }

    const options = members.status === "ready"
        ? members.members.map((member) => ({
              value: member.userId,
              label: personName(member),
              // Both, in full, so two colleagues of one name stay apart.
              suffix:
                  member.displayName?.trim() && member.email
                      ? `(${member.email})`
                      : undefined,
          }))
        : [];
    const chosen = options.find((option) => option.value === colleague);
    const messageClass =
        "rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";

    return (
        <form
            noValidate
            aria-label={escalateFormLabel(ruleName)}
            onSubmit={submit}
            className="space-y-2"
        >
            {members.status === "loading" ? (
                <p
                    key="loading"
                    ref={messageRef}
                    role="status"
                    tabIndex={-1}
                    className={`${messageClass} text-gray-500`}
                >
                    {DECISION_TEXT.loadingMembers}
                </p>
            ) : members.status === "error" ? (
                <p key="error" role="alert" className="text-sm text-red-600">
                    {DECISION_TEXT.membersUnavailable}{" "}
                    <button
                        ref={retryRef}
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
            ) : !choosing ? (
                <p
                    key="none"
                    ref={messageRef}
                    tabIndex={-1}
                    className={`${messageClass} text-gray-700`}
                >
                    {DECISION_TEXT.noMembers}
                </p>
            ) : (
                <>
                    <label
                        htmlFor={memberId}
                        className="block text-xs font-medium text-gray-700"
                    >
                        {DECISION_TEXT.escalateTo}
                    </label>
                    <div ref={selectWrap} className="min-w-0">
                        <ModalSelect
                            id={memberId}
                            // The trigger shows the choice; its name says it too.
                            aria-label={
                                chosen
                                    ? `${DECISION_TEXT.escalateTo}: ${chosen.label}${chosen.suffix ? ` ${chosen.suffix}` : ""}`
                                    : undefined
                            }
                            value={colleague}
                            options={options}
                            placeholder={DECISION_TEXT.chooseColleague}
                            wrapLabels
                            onChange={setColleague}
                        />
                    </div>
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
                submitDisabled={!choosing || !colleague}
                onCancel={onCancel}
            />
        </form>
    );
}
