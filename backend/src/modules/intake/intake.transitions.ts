// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: status changes and assignment. Each runs in one database
// function (request_desk_change_status, request_desk_assign) that writes the
// change and its trail entry in the same transaction, and is then recorded in
// the audit history with ids only.

import type {
    RequestDeskChange,
    RequestDeskStatus,
} from "@mike/contracts";
import { AppError } from "../../lib/appError";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { resolveAssignee } from "./intake.requests";
import {
    CHANGE_FORBIDDEN_DETAIL,
    REQUEST_DESK_ASSIGNEE_TAKEN,
    REQUEST_DESK_STATUS_CONFLICT,
    REQUEST_NOT_FOUND,
    REQUEST_STATUSES,
    asRecord,
    assigneeNotMember,
    isAssigneeMembershipViolation,
    isOpenStatus,
    isRequestStatus,
    loadRequestForCaller,
    parseOptionalText,
    readDeskOutcome,
    recordRequestDeskAudit,
    serializeComments,
    serializeRequest,
    type DeskOutcome,
    type LoadedRequest,
    type RequestDeskCaller,
} from "./intake.shared";

const STATUS_DETAIL = `status must be one of: ${REQUEST_STATUSES.join(", ")}`;

/** The change as the caller sees it, from a function's outcome. */
async function changeResult(
    db: Db,
    caller: RequestDeskCaller,
    loaded: LoadedRequest,
    outcome: Extract<DeskOutcome, { outcome: "changed" | "unchanged" }>,
): Promise<ServiceResult<RequestDeskChange>> {
    const request = await serializeRequest(
        db,
        outcome.request,
        caller,
        loaded.orgRole,
    );
    if (!request.ok) return request;
    if (outcome.outcome === "unchanged")
        return ok({ changed: false, request: request.data, comment: null });
    const comments = await serializeComments(db, [outcome.comment]);
    if (!comments.ok) return comments;
    return ok({
        changed: true,
        request: request.data,
        comment: comments.data[0],
    });
}

function unreadableOutcome(): ServiceResult<never> {
    return internalFailure(
        new AppError("request_desk.outcome_unreadable", "request desk function returned an unknown outcome"),
    );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Move a request to another status. Owners and editors only: a viewer is
 * refused. Moving to the status it already has writes nothing. With
 * `expected_status`, a request someone else has moved meanwhile is a
 * conflict rather than being overwritten.
 */
export async function changeRequestStatus(
    db: Db,
    args: RequestDeskCaller & { requestId: string; body: unknown },
): Promise<ServiceResult<RequestDeskChange>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    if (loaded.data.role === "viewer")
        return failure("forbidden", CHANGE_FORBIDDEN_DETAIL);

    const body = asRecord(args.body);
    if (!isRequestStatus(body.status)) return failure("validation", STATUS_DETAIL);
    const status: RequestDeskStatus = body.status;
    const note = parseOptionalText(body.note, "note", 2000);
    if (!note.ok) return failure("validation", note.detail);
    let expected: RequestDeskStatus | null = null;
    if (body.expected_status !== undefined && body.expected_status !== null) {
        if (!isRequestStatus(body.expected_status))
            return failure("validation", `expected_${STATUS_DETAIL}`);
        expected = body.expected_status;
    }

    const { request } = loaded.data;
    const { data, error } = await db.rpc("request_desk_change_status", {
        p_request_id: request.id,
        p_org_id: request.org_id,
        p_actor_id: args.userId,
        p_status: status,
        p_note: note.value,
        p_expected_status: expected,
    });
    if (error) return internalFailure(error);
    const outcome = readDeskOutcome(data);
    if (!outcome) return unreadableOutcome();
    if (outcome.outcome === "not_found")
        return failure("not_found", REQUEST_NOT_FOUND);
    if (outcome.outcome === "conflict")
        return failure(
            "conflict",
            "Someone else changed this request's status. Refresh to see where it is now.",
            REQUEST_DESK_STATUS_CONFLICT,
        );
    if (outcome.outcome === "changed")
        await recordRequestDeskAudit(db, {
            caller: args,
            orgId: request.org_id,
            action: "request.status_changed",
            ids: { request_id: request.id, comment_id: outcome.comment.id },
        });
    return changeResult(db, args, loaded.data, outcome);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Assign a request to a current member (`assignee_email`), or clear it
 * (`assignee_email: null`). Owners and editors may assign anyone. A viewer
 * may only take an open, unassigned request for themselves; if a colleague
 * took it first, that is a conflict and their assignment stands.
 */
export async function assignRequest(
    db: Db,
    args: RequestDeskCaller & { requestId: string; body: unknown },
): Promise<ServiceResult<RequestDeskChange>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    const body = asRecord(args.body);
    if (!Object.hasOwn(body, "assignee_email"))
        return failure(
            "validation",
            "assignee_email is required: an email address, or null to unassign",
        );

    const { request, role } = loaded.data;
    let assigneeId: string | null = null;
    if (body.assignee_email !== null && body.assignee_email !== "") {
        const assignee = await resolveAssignee(db, request.org_id, body.assignee_email);
        if (!assignee.ok) return assignee;
        assigneeId = assignee.data.userId;
    }

    const takesIt =
        assigneeId === args.userId &&
        request.assignee_user_id === null &&
        isOpenStatus(request.status);
    if (role === "viewer" && !takesIt)
        return failure(
            "forbidden",
            "You can take an open request that nobody is assigned to. Ask its assignee or an organization owner or admin to reassign it.",
        );

    const { data, error } = await db.rpc("request_desk_assign", {
        p_request_id: request.id,
        p_org_id: request.org_id,
        p_actor_id: args.userId,
        p_assignee_user_id: assigneeId,
        // A viewer's take must not overwrite a colleague who took it first.
        p_only_if_unassigned: role === "viewer",
    });
    if (error)
        return isAssigneeMembershipViolation(error)
            ? assigneeNotMember()
            : internalFailure(error);
    const outcome = readDeskOutcome(data);
    if (!outcome) return unreadableOutcome();
    if (outcome.outcome === "not_found")
        return failure("not_found", REQUEST_NOT_FOUND);
    if (outcome.outcome === "conflict")
        return failure(
            "conflict",
            "Someone else has already taken this request.",
            REQUEST_DESK_ASSIGNEE_TAKEN,
        );
    if (outcome.outcome === "changed")
        await recordRequestDeskAudit(db, {
            caller: args,
            orgId: request.org_id,
            action: assigneeId ? "request.assigned" : "request.unassigned",
            ids: {
                request_id: request.id,
                comment_id: outcome.comment.id,
                assignee_user_id: assigneeId,
            },
        });
    return changeResult(db, args, loaded.data, outcome);
}
