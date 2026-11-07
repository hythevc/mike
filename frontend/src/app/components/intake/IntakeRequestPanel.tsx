// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { CloseButton } from "@/shared/ui/CloseButton";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { ModalTextInput } from "@/app/components/modals/ModalTextInput";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import {
    LIQUID_FLOAT_PANEL_SURFACE_CLASS,
} from "@/app/components/ui/liquid-surface";
import { notifyError } from "@/app/lib/userFacingError";
import {
    addIntakeRequestComment,
    assignIntakeRequest,
    changeIntakeRequestStatus,
    createIntakeMatter,
    listIntakeRequestComments,
    type RequestDeskComment,
    type RequestDeskRequest,
    type RequestDeskStatus,
} from "@/app/lib/mikeApi";
import {
    OPEN_STATUSES,
    STATUS_ORDER,
    personName,
    priorityLabel,
    statusLabel,
} from "./intakeLabels";

function timestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export interface IntakeRequestPanelProps {
    request: RequestDeskRequest;
    currentUserEmail: string | undefined;
    onClose: () => void;
    /** The request after an action changed it, for the board to fold back in. */
    onRequestChanged: (request: RequestDeskRequest) => void;
}

export function IntakeRequestPanel({
    request,
    currentUserEmail,
    onClose,
    onRequestChanged,
}: IntakeRequestPanelProps) {
    const [comments, setComments] = useState<RequestDeskComment[] | null>(null);
    const [commentsError, setCommentsError] = useState(false);
    const [commentText, setCommentText] = useState("");
    const [busy, setBusy] = useState<
        null | "status" | "assign" | "comment" | "matter"
    >(null);
    const [assignEmail, setAssignEmail] = useState("");

    const requestId = request.id;

    const loadComments = useCallback(
        async (signal?: AbortSignal) => {
            setCommentsError(false);
            try {
                const trail = await listIntakeRequestComments(requestId, signal);
                if (!signal?.aborted) setComments(trail);
            } catch (error) {
                if (signal?.aborted) return;
                setComments([]);
                setCommentsError(true);
                notifyError(error, {
                    action: "load the request's activity",
                    operation: "intake.request.comments",
                });
            }
        },
        [requestId],
    );

    // A new request selected: its own trail, and no half-typed comment carried
    // from the last one.
    useEffect(() => {
        const controller = new AbortController();
        setComments(null);
        setCommentText("");
        setAssignEmail("");
        void loadComments(controller.signal);
        return () => controller.abort();
    }, [loadComments]);

    function recordChange(
        updated: RequestDeskRequest,
        comment: RequestDeskComment | null,
    ) {
        onRequestChanged(updated);
        if (comment)
            setComments((current) => [...(current ?? []), comment]);
    }

    const canChange = request.access_role !== "viewer";
    const assignedToMe =
        !!currentUserEmail &&
        request.assignee?.email?.toLowerCase() === currentUserEmail.toLowerCase();
    const canTake =
        !canChange &&
        !request.assignee &&
        OPEN_STATUSES.includes(request.status);

    async function changeStatus(status: RequestDeskStatus) {
        setBusy("status");
        try {
            const result = await changeIntakeRequestStatus(requestId, status, {
                expectedStatus: request.status,
            });
            recordChange(result.request, result.comment);
        } catch (error) {
            notifyError(error, {
                action: "change the request's status",
                operation: "intake.request.status",
            });
        } finally {
            setBusy(null);
        }
    }

    async function assign(email: string | null) {
        setBusy("assign");
        try {
            const result = await assignIntakeRequest(requestId, email);
            recordChange(result.request, result.comment);
            setAssignEmail("");
        } catch (error) {
            notifyError(error, {
                action: email ? "assign the request" : "unassign the request",
                operation: "intake.request.assignee",
            });
        } finally {
            setBusy(null);
        }
    }

    async function submitComment() {
        const body = commentText.trim();
        if (!body) return;
        setBusy("comment");
        try {
            const comment = await addIntakeRequestComment(requestId, body);
            setComments((current) => [...(current ?? []), comment]);
            // Only clear once the server has it, so a failure keeps the draft.
            setCommentText("");
        } catch (error) {
            notifyError(error, {
                action: "add your comment",
                operation: "intake.request.comments",
            });
        } finally {
            setBusy(null);
        }
    }

    async function createMatter() {
        setBusy("matter");
        try {
            const result = await createIntakeMatter(requestId);
            recordChange(result.request, result.comment);
        } catch (error) {
            notifyError(error, {
                action: "create a matter from the request",
                operation: "intake.request.matter",
            });
        } finally {
            setBusy(null);
        }
    }

    return (
        <aside
            aria-label={`Request ${request.reference}`}
            className={`flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl ${LIQUID_FLOAT_PANEL_SURFACE_CLASS}`}
        >
            <div className="flex items-start gap-2 px-4 pt-4">
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                        {request.reference}
                    </p>
                    <h2 className="mt-0.5 break-words font-serif text-lg font-medium text-gray-900">
                        {request.title}
                    </h2>
                </div>
                <CloseButton onClick={onClose} label="Close request details" />
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
                <section className="space-y-2 text-xs">
                    <DetailRow label="Priority" value={priorityLabel(request.priority)} />
                    <DetailRow
                        label="Assignee"
                        value={
                            request.assignee
                                ? personName(request.assignee)
                                : "Unassigned"
                        }
                    />
                    <DetailRow
                        label="Due date"
                        value={request.sla_due_at ? timestamp(request.sla_due_at) : "—"}
                        note={request.is_overdue ? "Overdue" : undefined}
                    />
                    {request.request_type && (
                        <DetailRow label="Type" value={request.request_type} />
                    )}
                    {(request.requester_name || request.requester_email) && (
                        <DetailRow
                            label="Requester"
                            value={
                                request.requester_name ||
                                request.requester_email ||
                                "—"
                            }
                            note={
                                request.requester_name
                                    ? request.requester_email ?? undefined
                                    : undefined
                            }
                        />
                    )}
                    <DetailRow
                        label="Logged by"
                        value={
                            request.created_by
                                ? personName(request.created_by)
                                : request.source === "form"
                                  ? "Request form"
                                  : "—"
                        }
                        note={timestamp(request.created_at)}
                    />
                </section>

                {request.details && (
                    <section>
                        <h3 className="mb-1 text-xs font-semibold text-gray-700">
                            Details
                        </h3>
                        <p className="whitespace-pre-wrap text-xs text-gray-600">
                            {request.details}
                        </p>
                    </section>
                )}

                <section>
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                        Status
                    </h3>
                    {canChange ? (
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="sr-only">Change status</span>
                            <select
                                className={`${FORM_CONTROL_GLASS_CLASS} h-8 w-auto px-2 text-xs`}
                                value={request.status}
                                disabled={busy !== null}
                                onChange={(event) =>
                                    changeStatus(
                                        event.target.value as RequestDeskStatus,
                                    )
                                }
                            >
                                {STATUS_ORDER.map((status) => (
                                    <option key={status} value={status}>
                                        {statusLabel(status)}
                                    </option>
                                ))}
                            </select>
                            {busy === "status" && (
                                <Loader2
                                    aria-hidden="true"
                                    className="h-3 w-3 animate-spin text-gray-400"
                                />
                            )}
                        </label>
                    ) : (
                        <p className="text-xs text-gray-700">
                            {statusLabel(request.status)}
                        </p>
                    )}
                </section>

                <section>
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                        Assignment
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {canTake && (
                            <PillButtonUI
                                tone="black"
                                size="sm"
                                loading={busy === "assign"}
                                disabled={busy !== null || !currentUserEmail}
                                onClick={() =>
                                    currentUserEmail && assign(currentUserEmail)
                                }
                            >
                                Take this request
                            </PillButtonUI>
                        )}
                        {canChange && !assignedToMe && currentUserEmail && (
                            <PillButtonUI
                                tone="white"
                                size="sm"
                                loading={busy === "assign"}
                                disabled={busy !== null}
                                onClick={() => assign(currentUserEmail)}
                            >
                                Assign to me
                            </PillButtonUI>
                        )}
                        {canChange && request.assignee && (
                            <PillButtonUI
                                tone="white"
                                size="sm"
                                loading={busy === "assign"}
                                disabled={busy !== null}
                                onClick={() => assign(null)}
                            >
                                Unassign
                            </PillButtonUI>
                        )}
                    </div>
                    {canChange && (
                        <form
                            className="mt-2 flex items-center gap-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (assignEmail.trim()) assign(assignEmail.trim());
                            }}
                        >
                            <label htmlFor="intake-assign-email" className="sr-only">
                                Assign to a member by email
                            </label>
                            <ModalTextInput
                                id="intake-assign-email"
                                type="email"
                                value={assignEmail}
                                onChange={(event) =>
                                    setAssignEmail(event.target.value)
                                }
                                placeholder="Assign by email"
                                className="h-8 flex-1 text-xs"
                                disabled={busy !== null}
                            />
                            <PillButtonUI
                                tone="white"
                                size="sm"
                                type="submit"
                                disabled={busy !== null || !assignEmail.trim()}
                            >
                                Assign
                            </PillButtonUI>
                        </form>
                    )}
                </section>

                <section>
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                        Matter
                    </h3>
                    {request.matter ? (
                        request.matter.can_open ? (
                            <Link
                                href={`/projects/${encodeURIComponent(request.matter.id)}`}
                                className="text-xs font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                            >
                                Open matter
                                {request.matter.name ? `: ${request.matter.name}` : ""}
                            </Link>
                        ) : (
                            <p className="text-xs text-gray-500">
                                A matter has been created from this request.
                            </p>
                        )
                    ) : canChange ? (
                        <PillButtonUI
                            tone="black"
                            size="sm"
                            loading={busy === "matter"}
                            disabled={busy !== null}
                            onClick={createMatter}
                        >
                            Create matter
                        </PillButtonUI>
                    ) : (
                        <p className="text-xs text-gray-400">
                            No matter yet.
                        </p>
                    )}
                </section>

                <section>
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                        Activity
                    </h3>
                    <IntakeTrail
                        comments={comments}
                        error={commentsError}
                        onRetry={() => void loadComments()}
                    />
                    <form
                        className="mt-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitComment();
                        }}
                    >
                        <label htmlFor="intake-comment" className="sr-only">
                            Add a comment
                        </label>
                        <ModalTextarea
                            id="intake-comment"
                            value={commentText}
                            onChange={(event) => setCommentText(event.target.value)}
                            placeholder="Add a comment"
                            className="min-h-16 text-xs"
                            disabled={busy === "comment"}
                        />
                        <div className="mt-2 flex justify-end">
                            <PillButtonUI
                                tone="black"
                                size="sm"
                                type="submit"
                                loading={busy === "comment"}
                                disabled={busy === "comment" || !commentText.trim()}
                            >
                                Add comment
                            </PillButtonUI>
                        </div>
                    </form>
                </section>
            </div>
        </aside>
    );
}

function DetailRow({
    label,
    value,
    note,
}: {
    label: string;
    value: string;
    note?: string;
}) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-gray-400">{label}</span>
            <span className="min-w-0 break-words text-right text-gray-700">
                {value}
                {note ? (
                    <span className="block text-[11px] text-gray-400">{note}</span>
                ) : null}
            </span>
        </div>
    );
}

function trailEntryText(comment: RequestDeskComment): string {
    if (comment.kind === "status_change") {
        const from = comment.from_status ? statusLabel(comment.from_status) : null;
        const to = comment.to_status ? statusLabel(comment.to_status) : null;
        const change = from && to ? `Status changed from ${from} to ${to}` : "Status changed";
        return comment.body ? `${change} — ${comment.body}` : change;
    }
    if (comment.kind === "system") {
        const who = comment.subject ? personName(comment.subject) : null;
        if (comment.event === "assigned")
            return who ? `Assigned to ${who}` : "Assigned";
        if (comment.event === "unassigned") return "Unassigned";
        if (comment.event === "matter_created") return "Matter created from this request";
        return comment.body || "Updated";
    }
    return comment.body;
}

function IntakeTrail({
    comments,
    error,
    onRetry,
}: {
    comments: RequestDeskComment[] | null;
    error: boolean;
    onRetry: () => void;
}) {
    if (comments === null) {
        return (
            <p
                role="status"
                className="flex items-center gap-2 text-xs text-gray-400"
            >
                <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                Loading activity…
            </p>
        );
    }
    if (error) {
        return (
            <div className="text-xs text-gray-500">
                <p>Couldn&rsquo;t load the activity.</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-1 font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                    Try again
                </button>
            </div>
        );
    }
    if (comments.length === 0) {
        return <p className="text-xs text-gray-400">No activity yet.</p>;
    }
    return (
        <ul className="space-y-3">
            {comments.map((comment) => (
                <li key={comment.id} className="text-xs">
                    <p className="text-gray-700">{trailEntryText(comment)}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                        {comment.author ? personName(comment.author) : "System"}
                        {" · "}
                        {timestamp(comment.created_at)}
                    </p>
                </li>
            ))}
        </ul>
    );
}
