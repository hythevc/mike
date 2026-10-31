// SPDX-License-Identifier: AGPL-3.0-only
//
// Shared vocabulary, row shapes and helpers for the request desk topic files
// (see intake.service.ts for the list). Other modules reach the request desk
// only through that facade.
//
// Who may do what, on one request:
//
//   owner   the organization's owners and admins: everything
//   editor  the request's assignee and the member who logged it: edit its
//           details, change its status, assign it, create its matter
//   viewer  every other member: read it, comment on it, and take it while it
//           is open and unassigned
//
// The request desk exists only in team organizations. The Personal workspace
// has none, and asking for it is answered with REQUEST_DESK_ORG_ONLY.

import type {
    RequestDeskComment,
    RequestDeskCommentKind,
    RequestDeskEvent,
    RequestDeskMatter,
    RequestDeskPerson,
    RequestDeskPriority,
    RequestDeskRequest,
    RequestDeskRole,
    RequestDeskSource,
    RequestDeskStatus,
} from "@mike/contracts";
import { checkProjectAccess, getOrgRole, isOrgAdmin, type OrgRole } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { mapWithConcurrency } from "../../lib/concurrency";
import { isPersonalOrg } from "../../lib/personalOrgs";
import {
    failure,
    internalFailure,
    ok,
    type ServiceFailure,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { PERSONAL_WORKSPACE } from "../../lib/workspace";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES: readonly RequestDeskStatus[] = [
    "new",
    "in_progress",
    "waiting",
    "closed",
    "declined",
];
export const OPEN_STATUSES: readonly RequestDeskStatus[] = [
    "new",
    "in_progress",
    "waiting",
];
export const REQUEST_PRIORITIES: readonly RequestDeskPriority[] = [
    "low",
    "normal",
    "high",
    "urgent",
];

export function isRequestStatus(value: unknown): value is RequestDeskStatus {
    return (REQUEST_STATUSES as readonly unknown[]).includes(value);
}

export function isRequestPriority(value: unknown): value is RequestDeskPriority {
    return (REQUEST_PRIORITIES as readonly unknown[]).includes(value);
}

export function isOpenStatus(status: RequestDeskStatus): boolean {
    return OPEN_STATUSES.includes(status);
}

// Codes a client acts on. Each one is listed in CODE_KINDS
// (frontend/src/shared/lib/userError.ts).
export const REQUEST_DESK_ORG_ONLY = "request_desk_org_only";
export const REQUEST_DESK_ASSIGNEE_NOT_MEMBER = "request_desk_assignee_not_member";
export const REQUEST_DESK_ASSIGNEE_TAKEN = "request_desk_assignee_taken";
export const REQUEST_DESK_STATUS_CONFLICT = "request_desk_status_conflict";
export const REQUEST_DESK_MATTER_LINKED = "request_desk_matter_linked";

/** Same body as lib/workspace's sendWorkspaceFailure. */
const WORKSPACE_NOT_FOUND = "workspace_not_found";

export const REQUEST_NOT_FOUND = "Request not found";
const ORG_ONLY_DETAIL =
    "The request desk is only available in an organization's workspace.";
const ASSIGNEE_NOT_MEMBER_DETAIL =
    "Only current members of this organization can be assigned a request.";
export const CHANGE_FORBIDDEN_DETAIL =
    "Only the assignee, the person who logged this request, or an organization owner or admin can change it.";

export function assigneeNotMember(): ServiceFailure {
    return failure(
        "validation",
        ASSIGNEE_NOT_MEMBER_DETAIL,
        REQUEST_DESK_ASSIGNEE_NOT_MEMBER,
    );
}

/**
 * The guard trigger's refusal of an assignee who is not (or is no longer) a
 * member: the race behind an assignment the backend had already checked.
 */
export function isAssigneeMembershipViolation(error: unknown): boolean {
    const value = error as { code?: unknown; message?: unknown } | null;
    return (
        value?.code === "23514" &&
        typeof value.message === "string" &&
        value.message.includes("assignee is not a member")
    );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RequestRow = {
    id: string;
    org_id: string;
    reference: string;
    reference_number: number;
    title: string;
    details: string;
    request_type: string | null;
    status: RequestDeskStatus;
    priority: RequestDeskPriority;
    source: RequestDeskSource;
    requester_name: string | null;
    requester_email: string | null;
    assignee_user_id: string | null;
    project_id: string | null;
    created_by: string | null;
    sla_due_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
};

export type CommentRow = {
    id: string;
    request_id: string;
    org_id: string;
    author_user_id: string | null;
    kind: RequestDeskCommentKind;
    body: string;
    from_status: RequestDeskStatus | null;
    to_status: RequestDeskStatus | null;
    event: RequestDeskEvent | null;
    subject_user_id: string | null;
    created_at: string;
};

export const REQUEST_COLUMNS =
    "id, org_id, reference, reference_number, title, details, request_type, status, priority, source, requester_name, requester_email, assignee_user_id, project_id, created_by, sla_due_at, closed_at, created_at, updated_at";

export const COMMENT_COLUMNS =
    "id, request_id, org_id, author_user_id, kind, body, from_status, to_status, event, subject_user_id, created_at";

/** What one of the request desk functions answered (see the migration). */
export type DeskOutcome =
    | { outcome: "not_found" }
    | { outcome: "conflict"; request: RequestRow }
    | { outcome: "unchanged"; request: RequestRow }
    | { outcome: "changed"; request: RequestRow; comment: CommentRow };

export function readDeskOutcome(data: unknown): DeskOutcome | null {
    const value = data as {
        outcome?: unknown;
        request?: unknown;
        comment?: unknown;
    } | null;
    if (!value || typeof value !== "object") return null;
    const request = isRow(value.request) ? (value.request as RequestRow) : null;
    switch (value.outcome) {
        case "not_found":
            return { outcome: "not_found" };
        case "conflict":
            return request ? { outcome: "conflict", request } : null;
        case "unchanged":
            return request ? { outcome: "unchanged", request } : null;
        case "changed":
            return request && isRow(value.comment)
                ? {
                      outcome: "changed",
                      request,
                      comment: value.comment as CommentRow,
                  }
                : null;
        default:
            return null;
    }
}

function isRow(value: unknown): boolean {
    return (
        !!value &&
        typeof value === "object" &&
        typeof (value as { id?: unknown }).id === "string"
    );
}

/** A function returning one row answers with an object; tolerate an array. */
export function firstRow<T>(data: unknown): T | null {
    const row = Array.isArray(data) ? data[0] : data;
    return isRow(row) ? (row as T) : null;
}

// ---------------------------------------------------------------------------
// Scope and standing
// ---------------------------------------------------------------------------

export type RequestDeskCaller = {
    userId: string;
    userEmail?: string | null;
};

export type OrgScope = { orgId: string; orgRole: OrgRole };

/**
 * The organization a list, board or create names (`?workspace=` or `org_id`).
 * Personal, or no workspace at all, is refused with a code; an organization
 * the caller does not belong to reads as missing, as lib/workspace answers.
 */
export async function resolveRequestDeskOrg(
    db: Db,
    userId: string,
    raw: unknown,
): Promise<ServiceResult<OrgScope>> {
    if (raw === undefined || raw === null || raw === "" || raw === PERSONAL_WORKSPACE)
        return failure("validation", ORG_ONLY_DETAIL, REQUEST_DESK_ORG_ONLY);
    if (typeof raw !== "string" || !isUuid(raw))
        return failure(
            "validation",
            "workspace must be 'personal' or an organization id",
        );
    const orgId = raw.toLowerCase();
    const orgRole = await getOrgRole(userId, orgId, db);
    if (!orgRole)
        return failure("not_found", "Workspace not found", WORKSPACE_NOT_FOUND);
    // Asked only of a member, so the answer reveals nothing about another
    // person's organization. A person's own organization IS Personal.
    if (await isPersonalOrg(db, orgId))
        return failure("validation", ORG_ONLY_DETAIL, REQUEST_DESK_ORG_ONLY);
    return ok({ orgId, orgRole });
}

/** The caller's standing on one request; see the header. */
export function requestDeskRole(
    orgRole: OrgRole,
    request: Pick<RequestRow, "assignee_user_id" | "created_by">,
    userId: string,
): RequestDeskRole {
    if (isOrgAdmin(orgRole)) return "owner";
    if (request.assignee_user_id === userId || request.created_by === userId)
        return "editor";
    return "viewer";
}

export type LoadedRequest = {
    request: RequestRow;
    orgRole: OrgRole;
    role: RequestDeskRole;
};

/**
 * One request, if the caller can see it: they must be a current member of
 * its organization. Anything else is "not found", never "forbidden", so an id
 * cannot be probed.
 */
export async function loadRequestForCaller(
    db: Db,
    requestId: string,
    caller: RequestDeskCaller,
): Promise<ServiceResult<LoadedRequest>> {
    if (!isUuid(requestId)) return failure("not_found", REQUEST_NOT_FOUND);
    const { data, error } = await db
        .from("request_desk_requests")
        .select(REQUEST_COLUMNS)
        .eq("id", requestId)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", REQUEST_NOT_FOUND);
    const request = data as RequestRow;
    const orgRole = await getOrgRole(caller.userId, request.org_id, db);
    if (!orgRole) return failure("not_found", REQUEST_NOT_FOUND);
    return ok({
        request,
        orgRole,
        role: requestDeskRole(orgRole, request, caller.userId),
    });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

type PeopleIndex = Map<string, RequestDeskPerson>;
const personKey = (orgId: string, userId: string) => `${orgId}:${userId}`;

/**
 * Display details and current membership for the people rows name. A person
 * with no profile left keeps their id and nothing else.
 */
export async function loadPeople(
    db: Db,
    refs: { orgId: string; userId: string | null | undefined }[],
): Promise<ServiceResult<PeopleIndex>> {
    const wanted = refs.filter(
        (ref): ref is { orgId: string; userId: string } =>
            typeof ref.userId === "string",
    );
    const people: PeopleIndex = new Map();
    if (wanted.length === 0) return ok(people);
    const userIds = [...new Set(wanted.map((ref) => ref.userId))];
    const orgIds = [...new Set(wanted.map((ref) => ref.orgId))];
    const [profiles, members] = await Promise.all([
        db
            .from("user_profiles")
            .select("user_id, email, display_name")
            .in("user_id", userIds),
        db
            .from("org_members")
            .select("org_id, user_id")
            .in("org_id", orgIds)
            .in("user_id", userIds),
    ]);
    if (profiles.error) return internalFailure(profiles.error);
    if (members.error) return internalFailure(members.error);
    const profileById = new Map(
        ((profiles.data ?? []) as {
            user_id: string;
            email: string | null;
            display_name: string | null;
        }[]).map((profile) => [profile.user_id, profile]),
    );
    const memberships = new Set(
        ((members.data ?? []) as { org_id: string; user_id: string }[]).map(
            (row) => personKey(row.org_id, row.user_id),
        ),
    );
    for (const { orgId, userId } of wanted) {
        const profile = profileById.get(userId);
        people.set(personKey(orgId, userId), {
            user_id: userId,
            email: profile?.email ?? null,
            display_name: profile?.display_name ?? null,
            is_member: memberships.has(personKey(orgId, userId)),
        });
    }
    return ok(people);
}

function personFrom(
    people: PeopleIndex,
    orgId: string,
    userId: string | null,
): RequestDeskPerson | null {
    if (!userId) return null;
    return (
        people.get(personKey(orgId, userId)) ?? {
            user_id: userId,
            email: null,
            display_name: null,
            is_member: false,
        }
    );
}

/**
 * The matters rows link to, as the caller may see them: a matter's name only
 * goes to someone who can open it.
 */
async function loadMatters(
    db: Db,
    projectIds: (string | null)[],
    caller: RequestDeskCaller,
): Promise<ServiceResult<Map<string, RequestDeskMatter>>> {
    const ids = [
        ...new Set(projectIds.filter((id): id is string => typeof id === "string")),
    ];
    const matters = new Map<string, RequestDeskMatter>();
    if (ids.length === 0) return ok(matters);
    const access = await mapWithConcurrency(ids, 4, (id) =>
        checkProjectAccess(id, caller.userId, caller.userEmail, db),
    );
    const openable = ids.filter((_, index) => access[index].ok);
    const names = new Map<string, string>();
    if (openable.length > 0) {
        const { data, error } = await db
            .from("projects")
            .select("id, name")
            .in("id", openable);
        if (error) return internalFailure(error);
        for (const row of (data ?? []) as { id: string; name: string }[])
            names.set(row.id, row.name);
    }
    for (const id of ids) {
        const name = names.get(id) ?? null;
        matters.set(id, { id, name, can_open: name !== null });
    }
    return ok(matters);
}

export function isOverdue(
    row: Pick<RequestRow, "status" | "sla_due_at">,
    now: Date,
): boolean {
    if (!isOpenStatus(row.status) || !row.sla_due_at) return false;
    const due = Date.parse(row.sla_due_at);
    return Number.isFinite(due) && due < now.getTime();
}

/**
 * Requests as the caller sees them. Every row must belong to the
 * organization `orgRole` was read for.
 */
export async function serializeRequests(
    db: Db,
    rows: RequestRow[],
    caller: RequestDeskCaller,
    orgRole: OrgRole,
    now: Date = new Date(),
): Promise<ServiceResult<RequestDeskRequest[]>> {
    if (rows.length === 0) return ok([]);
    const people = await loadPeople(
        db,
        rows.flatMap((row) => [
            { orgId: row.org_id, userId: row.assignee_user_id },
            { orgId: row.org_id, userId: row.created_by },
        ]),
    );
    if (!people.ok) return people;
    const matters = await loadMatters(
        db,
        rows.map((row) => row.project_id),
        caller,
    );
    if (!matters.ok) return matters;
    return ok(
        rows.map((row) => ({
            id: row.id,
            org_id: row.org_id,
            reference: row.reference,
            reference_number: Number(row.reference_number),
            title: row.title,
            details: row.details ?? "",
            request_type: row.request_type ?? null,
            status: row.status,
            priority: row.priority,
            source: row.source,
            requester_name: row.requester_name ?? null,
            requester_email: row.requester_email ?? null,
            assignee: personFrom(people.data, row.org_id, row.assignee_user_id),
            created_by: personFrom(people.data, row.org_id, row.created_by),
            matter: row.project_id
                ? (matters.data.get(row.project_id) ?? {
                      id: row.project_id,
                      name: null,
                      can_open: false,
                  })
                : null,
            sla_due_at: row.sla_due_at ?? null,
            is_overdue: isOverdue(row, now),
            closed_at: row.closed_at ?? null,
            created_at: row.created_at,
            updated_at: row.updated_at,
            access_role: requestDeskRole(orgRole, row, caller.userId),
        })),
    );
}

export async function serializeRequest(
    db: Db,
    row: RequestRow,
    caller: RequestDeskCaller,
    orgRole: OrgRole,
): Promise<ServiceResult<RequestDeskRequest>> {
    const serialized = await serializeRequests(db, [row], caller, orgRole);
    if (!serialized.ok) return serialized;
    return ok(serialized.data[0]);
}

export async function serializeComments(
    db: Db,
    rows: CommentRow[],
): Promise<ServiceResult<RequestDeskComment[]>> {
    const people = await loadPeople(
        db,
        rows.flatMap((row) => [
            { orgId: row.org_id, userId: row.author_user_id },
            { orgId: row.org_id, userId: row.subject_user_id },
        ]),
    );
    if (!people.ok) return people;
    return ok(
        rows.map((row) => ({
            id: row.id,
            request_id: row.request_id,
            kind: row.kind,
            body: row.body ?? "",
            from_status: row.from_status ?? null,
            to_status: row.to_status ?? null,
            event: row.event ?? null,
            subject: personFrom(people.data, row.org_id, row.subject_user_id),
            author: personFrom(people.data, row.org_id, row.author_user_id),
            created_at: row.created_at,
        })),
    );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const INTAKE_AUDIT_SURFACE = "intake";

export type RequestDeskAuditAction =
    | "request.created"
    | "request.updated"
    | "request.status_changed"
    | "request.assigned"
    | "request.unassigned"
    | "request.commented"
    | "request.matter_created";

/**
 * One audit row per action, carrying ids only: never a title, details,
 * requester data, a note or a comment. recordAudit never throws.
 */
export function recordRequestDeskAudit(
    db: Db,
    event: {
        caller: RequestDeskCaller;
        orgId: string;
        action: RequestDeskAuditAction;
        projectId?: string | null;
        ids: Record<string, string | null>;
    },
): Promise<void> {
    return recordAudit(db, {
        userId: event.caller.userId,
        userEmail: event.caller.userEmail ?? null,
        orgId: event.orgId,
        action: event.action,
        surface: INTAKE_AUDIT_SURFACE,
        projectId: event.projectId ?? null,
        detail: event.ids,
    });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

export function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

const absent = (value: unknown) =>
    value === undefined || value === null || value === "";

export function parseTitle(value: unknown): Parsed<string> {
    if (typeof value !== "string" || !value.trim())
        return { ok: false, detail: "title is required" };
    const title = value.trim();
    if (title.length > 200)
        return { ok: false, detail: "title must be at most 200 characters" };
    return { ok: true, value: title };
}

export function parseDetails(value: unknown): Parsed<string> {
    if (absent(value)) return { ok: true, value: "" };
    if (typeof value !== "string")
        return { ok: false, detail: "details must be text" };
    if (value.length > 20000)
        return { ok: false, detail: "details must be at most 20000 characters" };
    return { ok: true, value };
}

/** Optional short text: trimmed, empty means none. */
export function parseOptionalText(
    value: unknown,
    field: string,
    max: number,
): Parsed<string | null> {
    if (absent(value)) return { ok: true, value: null };
    if (typeof value !== "string")
        return { ok: false, detail: `${field} must be text` };
    const text = value.trim();
    if (!text) return { ok: true, value: null };
    if (text.length > max)
        return { ok: false, detail: `${field} must be at most ${max} characters` };
    return { ok: true, value: text };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRequesterEmail(value: unknown): Parsed<string | null> {
    const text = parseOptionalText(value, "requester_email", 320);
    if (!text.ok || text.value === null) return text;
    if (!EMAIL_PATTERN.test(text.value))
        return { ok: false, detail: "requester_email must be an email address" };
    return { ok: true, value: text.value.toLowerCase() };
}

export function parsePriority(value: unknown): Parsed<RequestDeskPriority> {
    if (absent(value)) return { ok: true, value: "normal" };
    if (!isRequestPriority(value))
        return {
            ok: false,
            detail: `priority must be one of: ${REQUEST_PRIORITIES.join(", ")}`,
        };
    return { ok: true, value };
}

/**
 * A due date: an ISO 8601 date-time, or a calendar date, which means the end
 * of that day (UTC) so a request due "on the 5th" is not overdue during the
 * 5th. Empty clears it.
 */
export function parseDueDate(value: unknown): Parsed<string | null> {
    if (absent(value)) return { ok: true, value: null };
    const invalid = { ok: false, detail: "sla_due_at must be an ISO 8601 date" } as const;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value))
        return invalid;
    const instant = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T23:59:59.999Z`
        : value;
    const time = Date.parse(instant);
    if (!Number.isFinite(time)) return invalid;
    return { ok: true, value: new Date(time).toISOString() };
}
