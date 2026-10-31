// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: list, read, log and edit requests. Status changes and
// assignment live in intake.transitions.ts, the matter in intake.matter.ts.
// Every function takes `db` first and returns a ServiceResult.

import type {
    RequestDeskPriority,
    RequestDeskRequest,
    RequestDeskRequestPage,
    RequestDeskStatus,
} from "@mike/contracts";
import { findAssignableOrgMember } from "../../lib/orgAccessOverrides";
import { AppError } from "../../lib/appError";
import { parsePaginationQuery } from "../../lib/pagination";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import {
    CHANGE_FORBIDDEN_DETAIL,
    OPEN_STATUSES,
    REQUEST_COLUMNS,
    REQUEST_NOT_FOUND,
    REQUEST_PRIORITIES,
    REQUEST_STATUSES,
    asRecord,
    assigneeNotMember,
    firstRow,
    isAssigneeMembershipViolation,
    isRequestPriority,
    isRequestStatus,
    loadRequestForCaller,
    parseDetails,
    parseDueDate,
    parseOptionalText,
    parsePriority,
    parseRequesterEmail,
    parseTitle,
    recordRequestDeskAudit,
    resolveRequestDeskOrg,
    serializeRequest,
    serializeRequests,
    type Parsed,
    type RequestDeskCaller,
    type RequestRow,
} from "./intake.shared";

// ---------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------

/**
 * The member an `assignee_email` names. A request has no creator-owner and no
 * public/private split, so neither of the access-override rules in
 * findAssignableOrgMember applies: it is called with no creator and a
 * visibility that is not "organization", which leaves "is a current member".
 */
export async function resolveAssignee(
    db: Db,
    orgId: string,
    email: unknown,
): Promise<ServiceResult<{ userId: string }>> {
    if (typeof email !== "string" || !email.trim())
        return failure("validation", "assignee_email must be an email address");
    const found = await findAssignableOrgMember(db, orgId, email, null, null);
    if (!found.ok) {
        if (found.kind === "validation") return assigneeNotMember();
        return internalFailure(found.error);
    }
    return ok({ userId: found.member.userId });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const SORT_COLUMNS = {
    created: "created_at",
    updated: "updated_at",
    due: "sla_due_at",
    priority: "priority_rank",
    reference: "reference_number",
} as const;

type SortKey = keyof typeof SORT_COLUMNS;

export type RequestListFilters = {
    statuses: RequestDeskStatus[] | null;
    priorities: RequestDeskPriority[] | null;
    /** undefined: anyone; null: unassigned; a user id: that person. */
    assignee: string | null | undefined;
    overdue: boolean;
    dueBefore: string | null;
    sort: { column: (typeof SORT_COLUMNS)[SortKey]; ascending: boolean };
};

function listValues(raw: unknown): string[] | null {
    if (raw === undefined || raw === null || raw === "") return null;
    const parts = (Array.isArray(raw) ? raw : [raw])
        .flatMap((value) => (typeof value === "string" ? value.split(",") : [null]))
        .map((value) => (typeof value === "string" ? value.trim() : value));
    return parts.some((value) => typeof value !== "string" || !value)
        ? []
        : (parts as string[]);
}

/**
 * `status` and `priority` take comma-separated values (`status=open` is the
 * three open statuses); `assignee` is `me`, `none` or a user id; `overdue=true`
 * keeps open requests past their due date; `due_before` an ISO date;
 * `sort_key` one of created, updated, due, priority, reference with
 * `sort_direction` asc or desc.
 */
export function parseRequestListFilters(
    query: Record<string, unknown>,
    userId: string,
): Parsed<RequestListFilters> {
    let statuses: RequestDeskStatus[] | null = null;
    const statusValues = listValues(query.status);
    if (statusValues) {
        const expanded = statusValues.flatMap((value) =>
            value === "open" ? [...OPEN_STATUSES] : [value],
        );
        if (expanded.length === 0 || !expanded.every(isRequestStatus))
            return {
                ok: false,
                detail: `status must be open or one of: ${REQUEST_STATUSES.join(", ")}`,
            };
        statuses = [...new Set(expanded)];
    }

    let priorities: RequestDeskPriority[] | null = null;
    const priorityValues = listValues(query.priority);
    if (priorityValues) {
        if (priorityValues.length === 0 || !priorityValues.every(isRequestPriority))
            return {
                ok: false,
                detail: `priority must be one of: ${REQUEST_PRIORITIES.join(", ")}`,
            };
        priorities = [...new Set(priorityValues)] as RequestDeskPriority[];
    }

    let assignee: string | null | undefined;
    const rawAssignee = query.assignee;
    if (rawAssignee === "me") assignee = userId;
    else if (rawAssignee === "none") assignee = null;
    else if (typeof rawAssignee === "string" && isUuid(rawAssignee))
        assignee = rawAssignee.toLowerCase();
    else if (rawAssignee !== undefined && rawAssignee !== "")
        return { ok: false, detail: "assignee must be me, none or a user id" };

    let overdue = false;
    if (query.overdue === "true") overdue = true;
    else if (query.overdue !== undefined && query.overdue !== "false" && query.overdue !== "")
        return { ok: false, detail: "overdue must be true or false" };

    const dueBefore = parseDueDate(query.due_before);
    if (!dueBefore.ok)
        return { ok: false, detail: "due_before must be an ISO 8601 date" };

    const rawKey = typeof query.sort_key === "string" ? query.sort_key : "created";
    if (!Object.hasOwn(SORT_COLUMNS, rawKey))
        return {
            ok: false,
            detail: `sort_key must be one of: ${Object.keys(SORT_COLUMNS).join(", ")}`,
        };
    const key = rawKey as SortKey;
    const direction =
        query.sort_direction === "asc" || query.sort_direction === "desc"
            ? query.sort_direction
            : key === "due"
              ? "asc"
              : "desc";

    return {
        ok: true,
        value: {
            statuses,
            priorities,
            assignee,
            overdue,
            dueBefore: dueBefore.value,
            sort: { column: SORT_COLUMNS[key], ascending: direction === "asc" },
        },
    };
}

/** One page of an organization's requests, filtered and sorted. */
export async function listRequests(
    db: Db,
    args: RequestDeskCaller & {
        workspace: unknown;
        query: Record<string, unknown>;
    },
): Promise<ServiceResult<RequestDeskRequestPage>> {
    const scope = await resolveRequestDeskOrg(db, args.userId, args.workspace);
    if (!scope.ok) return scope;
    const filters = parseRequestListFilters(args.query, args.userId);
    if (!filters.ok) return failure("validation", filters.detail);
    const { statuses, priorities, assignee, overdue, dueBefore, sort } =
        filters.value;
    const { limit, offset } = parsePaginationQuery(args.query);

    let query = db
        .from("request_desk_requests")
        .select(REQUEST_COLUMNS, { count: "exact" })
        .eq("org_id", scope.data.orgId);
    if (statuses) query = query.in("status", statuses);
    if (priorities) query = query.in("priority", priorities);
    if (assignee === null) query = query.is("assignee_user_id", null);
    else if (assignee) query = query.eq("assignee_user_id", assignee);
    if (overdue)
        query = query
            .in("status", [...OPEN_STATUSES])
            .lt("sla_due_at", new Date().toISOString());
    if (dueBefore) query = query.lte("sla_due_at", dueBefore);
    const { data, error, count } = await query
        .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
        .order("reference_number", { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) return internalFailure(error);

    const requests = await serializeRequests(
        db,
        (data ?? []) as unknown as RequestRow[],
        args,
        scope.data.orgRole,
    );
    if (!requests.ok) return requests;
    return ok({ requests: requests.data, total: count ?? 0, limit, offset });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getRequest(
    db: Db,
    args: RequestDeskCaller & { requestId: string },
): Promise<ServiceResult<RequestDeskRequest>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    return serializeRequest(db, loaded.data.request, args, loaded.data.orgRole);
}

// ---------------------------------------------------------------------------
// Log a request
// ---------------------------------------------------------------------------

type RequestFields = {
    title: string;
    details: string;
    request_type: string | null;
    priority: RequestDeskPriority;
    requester_name: string | null;
    requester_email: string | null;
    sla_due_at: string | null;
};

/** The parsers for every field a member can set or edit. */
const FIELD_PARSERS: {
    [K in keyof RequestFields]: (value: unknown) => Parsed<RequestFields[K]>;
} = {
    title: parseTitle,
    details: parseDetails,
    request_type: (value) => parseOptionalText(value, "request_type", 80),
    priority: parsePriority,
    requester_name: (value) => parseOptionalText(value, "requester_name", 200),
    requester_email: parseRequesterEmail,
    sla_due_at: parseDueDate,
};

function parseFields(
    body: Record<string, unknown>,
    only?: (keyof RequestFields)[],
): Parsed<Partial<RequestFields>> {
    const fields: Partial<Record<keyof RequestFields, unknown>> = {};
    const keys = only ?? (Object.keys(FIELD_PARSERS) as (keyof RequestFields)[]);
    for (const key of keys) {
        const parsed = FIELD_PARSERS[key](body[key]);
        if (!parsed.ok) return parsed;
        fields[key] = parsed.value;
    }
    return { ok: true, value: fields as Partial<RequestFields> };
}

/**
 * Log a request in an organization's request desk. Any member may; the
 * reference comes from the database (request_desk_create_request), so
 * concurrent creates never share one. `assignee_email` optionally assigns it.
 */
export async function createRequest(
    db: Db,
    args: RequestDeskCaller & { body: unknown },
): Promise<ServiceResult<RequestDeskRequest>> {
    const body = asRecord(args.body);
    const scope = await resolveRequestDeskOrg(db, args.userId, body.org_id);
    if (!scope.ok) return scope;
    const parsed = parseFields(body);
    if (!parsed.ok) return failure("validation", parsed.detail);
    const fields = parsed.value as RequestFields;

    let assigneeId: string | null = null;
    if (body.assignee_email !== undefined && body.assignee_email !== null && body.assignee_email !== "") {
        const assignee = await resolveAssignee(db, scope.data.orgId, body.assignee_email);
        if (!assignee.ok) return assignee;
        assigneeId = assignee.data.userId;
    }

    const { data, error } = await db.rpc("request_desk_create_request", {
        p_org_id: scope.data.orgId,
        p_created_by: args.userId,
        p_source: "internal",
        p_title: fields.title,
        p_details: fields.details,
        p_request_type: fields.request_type,
        p_priority: fields.priority,
        p_requester_name: fields.requester_name,
        p_requester_email: fields.requester_email,
        p_assignee_user_id: assigneeId,
        p_sla_due_at: fields.sla_due_at,
    });
    if (error)
        return isAssigneeMembershipViolation(error)
            ? assigneeNotMember()
            : internalFailure(error);
    const row = firstRow<RequestRow>(data);
    if (!row)
        return internalFailure(
            new AppError("request_desk.create_failed", "request_desk_create_request returned no row"),
        );

    await recordRequestDeskAudit(db, {
        caller: args,
        orgId: row.org_id,
        action: "request.created",
        ids: {
            request_id: row.id,
            ...(assigneeId ? { assignee_user_id: assigneeId } : {}),
        },
    });
    return serializeRequest(db, row, args, scope.data.orgRole);
}

// ---------------------------------------------------------------------------
// Edit a request's details
// ---------------------------------------------------------------------------

/** Changed only through their own operations, each with its trail entry. */
const NOT_EDITABLE_HERE: Record<string, string> = {
    status: "status is changed through the request's status action",
    assignee_email: "assignment is changed through the request's assignee action",
    assignee_user_id: "assignment is changed through the request's assignee action",
    project_id: "a matter is linked by creating it from the request",
    org_id: "a request cannot move to another organization",
};

export async function updateRequest(
    db: Db,
    args: RequestDeskCaller & { requestId: string; body: unknown },
): Promise<ServiceResult<RequestDeskRequest>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    const { request, orgRole, role } = loaded.data;
    if (role === "viewer") return failure("forbidden", CHANGE_FORBIDDEN_DETAIL);

    const body = asRecord(args.body);
    const misplaced = Object.keys(NOT_EDITABLE_HERE).find((key) => Object.hasOwn(body, key));
    if (misplaced) return failure("validation", NOT_EDITABLE_HERE[misplaced]);
    const keys = (Object.keys(FIELD_PARSERS) as (keyof RequestFields)[]).filter(
        (key) => Object.hasOwn(body, key),
    );
    if (keys.length === 0) return failure("validation", "Nothing to update");
    const parsed = parseFields(body, keys);
    if (!parsed.ok) return failure("validation", parsed.detail);

    const { data, error } = await db
        .from("request_desk_requests")
        .update({ ...parsed.value, updated_at: new Date().toISOString() })
        .eq("id", request.id)
        .eq("org_id", request.org_id)
        .select(REQUEST_COLUMNS)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", REQUEST_NOT_FOUND);

    await recordRequestDeskAudit(db, {
        caller: args,
        orgId: request.org_id,
        action: "request.updated",
        ids: { request_id: request.id },
    });
    return serializeRequest(db, data as unknown as RequestRow, args, orgRole);
}
