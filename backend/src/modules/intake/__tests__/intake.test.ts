// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../lib/supabase";
import {
    addRequestComment,
    assignRequest,
    changeRequestStatus,
    createRequest,
    getRequest,
    getRequestDeskBoard,
    listRequestComments,
    listRequests,
    updateRequest,
} from "../intake.service";
import { readBoardSummary } from "../intake.board";
import { parseRequestListFilters } from "../intake.requests";
import {
    isOverdue,
    parseDueDate,
    parseRequesterEmail,
    parseTitle,
    readDeskOutcome,
    requestDeskRole,
} from "../intake.shared";
import {
    FIRM,
    OTHER_ORG,
    PEOPLE,
    PERSONAL_ORG,
    auditRows,
    desk,
    deskClient,
    seedFirm,
    table,
} from "./deskDbFake";

const db = () => deskClient() as unknown as Db;
const as = (person: { id: string; email: string }) => ({
    userId: person.id,
    userEmail: person.email,
});

async function logRequest(
    by: { id: string; email: string } = PEOPLE.member,
    body: Record<string, unknown> = {},
) {
    const result = await createRequest(db(), {
        ...as(by),
        body: { org_id: FIRM, title: "Review supplier terms", ...body },
    });
    if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`);
    return result.data;
}

/** Audit rows carry ids, never request content. */
function expectIdsOnly(row: Record<string, unknown>, ...content: string[]) {
    expect(row.surface).toBe("intake");
    expect(row.title ?? null).toBeNull();
    const detail = row.detail as Record<string, unknown>;
    for (const [key, value] of Object.entries(detail)) {
        expect(key).toMatch(/_id$/);
        if (value !== null)
            expect(value).toMatch(/^[0-9a-f-]{36}$/);
    }
    const serialized = JSON.stringify(row);
    for (const text of content) expect(serialized).not.toContain(text);
}

beforeEach(() => seedFirm());

describe("request desk standing", () => {
    it("gives organization owners and admins Owner, the assignee and the logger Editor, everyone else Viewer", () => {
        const request = { assignee_user_id: "assignee", created_by: "logger" };
        expect(requestDeskRole("owner", request, "someone")).toBe("owner");
        expect(requestDeskRole("admin", request, "someone")).toBe("owner");
        expect(requestDeskRole("member", request, "assignee")).toBe("editor");
        expect(requestDeskRole("member", request, "logger")).toBe("editor");
        expect(requestDeskRole("member", request, "someone")).toBe("viewer");
        expect(
            requestDeskRole("member", { assignee_user_id: null, created_by: null }, "someone"),
        ).toBe("viewer");
    });
});

describe("request desk input", () => {
    it("requires a title of at most 200 characters, trimmed", () => {
        expect(parseTitle("  NDA for Acme  ")).toEqual({ ok: true, value: "NDA for Acme" });
        expect(parseTitle("   ").ok).toBe(false);
        expect(parseTitle(undefined).ok).toBe(false);
        expect(parseTitle("x".repeat(201)).ok).toBe(false);
    });

    it("lowercases a requester email and refuses one that is not an address", () => {
        expect(parseRequesterEmail(" Dana@Client.Example ")).toEqual({
            ok: true,
            value: "dana@client.example",
        });
        expect(parseRequesterEmail("")).toEqual({ ok: true, value: null });
        expect(parseRequesterEmail("not an email").ok).toBe(false);
    });

    it("reads a calendar due date as the end of that day", () => {
        expect(parseDueDate("2026-11-05")).toEqual({
            ok: true,
            value: "2026-11-05T23:59:59.999Z",
        });
        expect(parseDueDate("2026-11-05T09:30:00Z")).toEqual({
            ok: true,
            value: "2026-11-05T09:30:00.000Z",
        });
        expect(parseDueDate(null)).toEqual({ ok: true, value: null });
        expect(parseDueDate("next Tuesday").ok).toBe(false);
        expect(parseDueDate("2026-13-45").ok).toBe(false);
    });

    it("counts only open requests past their due date as overdue", () => {
        const now = new Date("2026-11-10T00:00:00Z");
        const past = "2026-11-01T00:00:00Z";
        expect(isOverdue({ status: "new", sla_due_at: past }, now)).toBe(true);
        expect(isOverdue({ status: "waiting", sla_due_at: past }, now)).toBe(true);
        expect(isOverdue({ status: "closed", sla_due_at: past }, now)).toBe(false);
        expect(isOverdue({ status: "new", sla_due_at: "2026-12-01T00:00:00Z" }, now)).toBe(false);
        expect(isOverdue({ status: "new", sla_due_at: null }, now)).toBe(false);
    });

    it("parses list filters and refuses unknown values", () => {
        const parsed = parseRequestListFilters(
            { status: "open", priority: "high,urgent", assignee: "me", sort_key: "due" },
            PEOPLE.member.id,
        );
        expect(parsed).toEqual({
            ok: true,
            value: {
                statuses: ["new", "in_progress", "waiting"],
                priorities: ["high", "urgent"],
                assignee: PEOPLE.member.id,
                overdue: false,
                dueBefore: null,
                sort: { column: "sla_due_at", ascending: true },
            },
        });
        expect(parseRequestListFilters({ assignee: "none" }, "u").ok && true).toBe(true);
        expect(parseRequestListFilters({ status: "archived" }, "u").ok).toBe(false);
        expect(parseRequestListFilters({ status: "new," }, "u").ok).toBe(false);
        expect(parseRequestListFilters({ priority: "critical" }, "u").ok).toBe(false);
        expect(parseRequestListFilters({ assignee: "someone" }, "u").ok).toBe(false);
        expect(parseRequestListFilters({ sort_key: "title" }, "u").ok).toBe(false);
        expect(parseRequestListFilters({ sort_key: "toString" }, "u").ok).toBe(false);
    });

    it("reads the database functions' outcomes and nothing else", () => {
        const request = { id: "r" };
        expect(readDeskOutcome({ outcome: "not_found" })).toEqual({ outcome: "not_found" });
        expect(readDeskOutcome({ outcome: "unchanged", request })).toEqual({
            outcome: "unchanged",
            request,
        });
        expect(readDeskOutcome({ outcome: "changed", request })).toBeNull();
        expect(readDeskOutcome({ outcome: "moved", request })).toBeNull();
        expect(readDeskOutcome(null)).toBeNull();
    });

    it("turns the board function's counts into whole numbers", () => {
        const summary = readBoardSummary(
            { total: "4", open: 3, overdue: -1, by_status: { new: 2, closed: "1" } },
            FIRM,
            new Date("2026-10-31T00:00:00Z"),
        );
        expect(summary).toEqual({
            org_id: FIRM,
            total: 4,
            open: 3,
            overdue: 0,
            unassigned: 0,
            assigned_to_me: 0,
            by_status: { new: 2, in_progress: 0, waiting: 0, closed: 1, declined: 0 },
            open_by_priority: { low: 0, normal: 0, high: 0, urgent: 0 },
            generated_at: "2026-10-31T00:00:00.000Z",
        });
    });
});

describe("logging a request", () => {
    it("is refused in the Personal workspace, or with no workspace, with a code", async () => {
        for (const org_id of [undefined, null, "", "personal", PERSONAL_ORG]) {
            const result = await createRequest(db(), {
                ...as(PEOPLE.member),
                body: { org_id, title: "Lease review" },
            });
            expect(result).toMatchObject({
                ok: false,
                kind: "validation",
                code: "request_desk_org_only",
            });
        }
        expect(table("request_desk_requests")).toHaveLength(0);
    });

    it("reads an organization the caller does not belong to as missing", async () => {
        const result = await createRequest(db(), {
            ...as(PEOPLE.member),
            body: { org_id: OTHER_ORG, title: "Lease review" },
        });
        expect(result).toMatchObject({
            ok: false,
            kind: "not_found",
            code: "workspace_not_found",
        });
    });

    it("numbers requests per organization and records one ids-only audit row", async () => {
        const first = await logRequest(PEOPLE.member, {
            details: "Their paper, our risk.",
            requester_name: "Dana Client",
            requester_email: "dana@client.example",
            priority: "high",
            sla_due_at: "2026-11-05",
        });
        const second = await logRequest(PEOPLE.colleague);
        expect([first.reference, second.reference]).toEqual(["REQ-1", "REQ-2"]);
        expect(first).toMatchObject({
            status: "new",
            priority: "high",
            source: "internal",
            requester_email: "dana@client.example",
            sla_due_at: "2026-11-05T23:59:59.999Z",
            access_role: "editor",
            created_by: {
                user_id: PEOPLE.member.id,
                email: PEOPLE.member.email,
                is_member: true,
            },
            assignee: null,
            matter: null,
        });
        const created = auditRows().filter((row) => row.action === "request.created");
        expect(created).toHaveLength(2);
        expect(created[0]).toMatchObject({
            user_id: PEOPLE.member.id,
            org_id: FIRM,
            detail: { request_id: first.id },
        });
        expectIdsOnly(created[0], "Review supplier terms", "Dana", "dana@client.example", "risk");
    });

    it("assigns a member at creation, and refuses a non-member with a code", async () => {
        const assigned = await logRequest(PEOPLE.member, {
            assignee_email: PEOPLE.colleague.email,
        });
        expect(assigned.assignee).toMatchObject({ user_id: PEOPLE.colleague.id, is_member: true });

        const refused = await createRequest(db(), {
            ...as(PEOPLE.owner),
            body: { org_id: FIRM, title: "x", assignee_email: PEOPLE.outsider.email },
        });
        expect(refused).toMatchObject({
            ok: false,
            kind: "validation",
            code: "request_desk_assignee_not_member",
        });
        expect(table("request_desk_requests")).toHaveLength(1);
    });

    it("validates the fields before writing anything", async () => {
        const result = await createRequest(db(), {
            ...as(PEOPLE.member),
            body: { org_id: FIRM, title: "x", priority: "critical" },
        });
        expect(result).toMatchObject({ ok: false, kind: "validation" });
        expect(desk.rpcCalls).toHaveLength(0);
    });
});

describe("reading requests", () => {
    it("hides a request from anyone outside its organization", async () => {
        const request = await logRequest();
        const result = await getRequest(db(), { ...as(PEOPLE.outsider), requestId: request.id });
        expect(result).toMatchObject({ ok: false, kind: "not_found" });
        const malformed = await getRequest(db(), { ...as(PEOPLE.member), requestId: "REQ-1" });
        expect(malformed).toMatchObject({ ok: false, kind: "not_found" });
    });

    it("lists one organization's requests with filters, a total and the caller's role", async () => {
        const mine = await logRequest(PEOPLE.member, { priority: "urgent" });
        await logRequest(PEOPLE.colleague, { priority: "low" });
        const listed = await listRequests(db(), {
            ...as(PEOPLE.member),
            workspace: FIRM,
            query: { priority: "urgent,high" },
        });
        expect(listed.ok && listed.data.total).toBe(1);
        expect(listed.ok && listed.data.requests.map((r) => [r.id, r.access_role])).toEqual([
            [mine.id, "editor"],
        ]);

        const all = await listRequests(db(), {
            ...as(PEOPLE.member),
            workspace: FIRM,
            query: { sort_key: "reference", sort_direction: "asc" },
        });
        expect(all.ok && all.data.requests.map((r) => [r.reference, r.access_role])).toEqual([
            ["REQ-1", "editor"],
            ["REQ-2", "viewer"],
        ]);

        const personal = await listRequests(db(), {
            ...as(PEOPLE.member),
            workspace: "personal",
            query: {},
        });
        expect(personal).toMatchObject({ ok: false, code: "request_desk_org_only" });
    });

    it("counts the board in the database", async () => {
        await logRequest(PEOPLE.member, { assignee_email: PEOPLE.member.email });
        await logRequest(PEOPLE.member);
        const board = await getRequestDeskBoard(db(), { ...as(PEOPLE.member), workspace: FIRM });
        expect(board).toMatchObject({
            ok: true,
            data: { org_id: FIRM, total: 2, open: 2, unassigned: 1, assigned_to_me: 1 },
        });
        expect(desk.rpcCalls.at(-1)).toEqual({
            fn: "request_desk_board_summary",
            args: { p_org_id: FIRM, p_user_id: PEOPLE.member.id },
        });
        const personal = await getRequestDeskBoard(db(), {
            ...as(PEOPLE.member),
            workspace: "personal",
        });
        expect(personal).toMatchObject({ ok: false, code: "request_desk_org_only" });
    });
});

describe("changing a request's status", () => {
    it("refuses a viewer", async () => {
        const request = await logRequest(PEOPLE.colleague);
        const result = await changeRequestStatus(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { status: "in_progress" },
        });
        expect(result).toMatchObject({ ok: false, kind: "forbidden" });
        expect(desk.rpcCalls.map((call) => call.fn)).toEqual(["request_desk_create_request"]);
        expect(table("request_desk_comments")).toHaveLength(0);
    });

    it("writes one status_change entry and one ids-only audit row per change, and sets then clears closed_at", async () => {
        const request = await logRequest(PEOPLE.colleague, {
            assignee_email: PEOPLE.member.email,
        });
        const before = auditRows().length;

        const closed = await changeRequestStatus(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { status: "closed", note: "Advice sent to Dana" },
        });
        expect(closed.ok).toBe(true);
        if (!closed.ok) return;
        expect(closed.data.changed).toBe(true);
        expect(closed.data.request.status).toBe("closed");
        expect(closed.data.request.closed_at).not.toBeNull();
        expect(closed.data.comment).toMatchObject({
            kind: "status_change",
            from_status: "new",
            to_status: "closed",
            body: "Advice sent to Dana",
            author: { user_id: PEOPLE.member.id },
        });
        const statusEntries = () =>
            table("request_desk_comments").filter((row) => row.kind === "status_change");
        expect(statusEntries()).toHaveLength(1);
        const audits = auditRows().slice(before);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "request.status_changed",
            org_id: FIRM,
            detail: { request_id: request.id, comment_id: closed.data.comment!.id },
        });
        expectIdsOnly(audits[0], "Advice sent", "Dana", "Review supplier terms");

        const reopened = await changeRequestStatus(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { status: "in_progress" },
        });
        expect(reopened.ok && reopened.data.request.closed_at).toBeNull();
        expect(statusEntries()).toHaveLength(2);
        expect(auditRows().slice(before)).toHaveLength(2);
    });

    it("writes nothing when the status does not change", async () => {
        const request = await logRequest(PEOPLE.member);
        const before = auditRows().length;
        const result = await changeRequestStatus(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { status: "new" },
        });
        expect(result).toMatchObject({ ok: true, data: { changed: false, comment: null } });
        expect(table("request_desk_comments")).toHaveLength(0);
        expect(auditRows()).toHaveLength(before);
    });

    it("answers a conflict when someone else moved the request first", async () => {
        const request = await logRequest(PEOPLE.member);
        await changeRequestStatus(db(), {
            ...as(PEOPLE.owner),
            requestId: request.id,
            body: { status: "waiting" },
        });
        const result = await changeRequestStatus(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { status: "in_progress", expected_status: "new" },
        });
        expect(result).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "request_desk_status_conflict",
        });
    });

    it("refuses an unknown status before calling the database", async () => {
        const request = await logRequest(PEOPLE.member);
        for (const body of [{ status: "done" }, { status: "new", expected_status: "x" }]) {
            const result = await changeRequestStatus(db(), {
                ...as(PEOPLE.member),
                requestId: request.id,
                body,
            });
            expect(result).toMatchObject({ ok: false, kind: "validation" });
        }
        expect(desk.rpcCalls.map((call) => call.fn)).not.toContain("request_desk_change_status");
    });
});

describe("assigning a request", () => {
    it("lets an owner assign any member and refuses a non-member with a code", async () => {
        const request = await logRequest(PEOPLE.colleague);
        const refused = await assignRequest(db(), {
            ...as(PEOPLE.admin),
            requestId: request.id,
            body: { assignee_email: PEOPLE.outsider.email },
        });
        expect(refused).toMatchObject({
            ok: false,
            kind: "validation",
            code: "request_desk_assignee_not_member",
        });

        const assigned = await assignRequest(db(), {
            ...as(PEOPLE.admin),
            requestId: request.id,
            body: { assignee_email: PEOPLE.owner.email.toUpperCase() },
        });
        expect(assigned).toMatchObject({
            ok: true,
            data: {
                changed: true,
                request: { assignee: { user_id: PEOPLE.owner.id } },
                comment: { kind: "system", event: "assigned", subject: { user_id: PEOPLE.owner.id } },
            },
        });
        const audit = auditRows().filter((row) => row.action === "request.assigned");
        expect(audit).toHaveLength(1);
        expectIdsOnly(audit[0]);

        const cleared = await assignRequest(db(), {
            ...as(PEOPLE.admin),
            requestId: request.id,
            body: { assignee_email: null },
        });
        expect(cleared).toMatchObject({
            ok: true,
            data: {
                request: { assignee: null },
                comment: { event: "unassigned", subject: { user_id: PEOPLE.owner.id } },
            },
        });
    });

    it("lets a viewer take an open, unassigned request for themselves, and nothing else", async () => {
        const request = await logRequest(PEOPLE.colleague);
        const assignOther = await assignRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { assignee_email: PEOPLE.owner.email },
        });
        expect(assignOther).toMatchObject({ ok: false, kind: "forbidden" });

        const taken = await assignRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { assignee_email: PEOPLE.member.email },
        });
        expect(taken).toMatchObject({
            ok: true,
            data: { request: { access_role: "editor", assignee: { user_id: PEOPLE.member.id } } },
        });
        expect(desk.rpcCalls.at(-1)?.args.p_only_if_unassigned).toBe(true);
    });

    it("keeps the colleague who took it first", async () => {
        const request = await logRequest(PEOPLE.owner);
        desk.beforeRpc = (fn) => {
            if (fn !== "request_desk_assign") return;
            const row = table("request_desk_requests").find((r) => r.id === request.id)!;
            row.assignee_user_id = PEOPLE.colleague.id;
        };
        const result = await assignRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { assignee_email: PEOPLE.member.email },
        });
        expect(result).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "request_desk_assignee_taken",
        });
        expect(
            table("request_desk_requests").find((r) => r.id === request.id)?.assignee_user_id,
        ).toBe(PEOPLE.colleague.id);
    });

    it("maps the database's membership refusal onto the same code", async () => {
        const request = await logRequest(PEOPLE.owner);
        desk.rpcErrors.request_desk_assign = {
            code: "23514",
            message: "request desk: the assignee is not a member of the organization",
        };
        const result = await assignRequest(db(), {
            ...as(PEOPLE.owner),
            requestId: request.id,
            body: { assignee_email: PEOPLE.member.email },
        });
        expect(result).toMatchObject({ code: "request_desk_assignee_not_member" });
    });
});

describe("editing a request", () => {
    it("lets an editor change details and refuses a viewer", async () => {
        const request = await logRequest(PEOPLE.member);
        const edited = await updateRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { priority: "urgent", sla_due_at: null, request_type: " Contract review " },
        });
        expect(edited).toMatchObject({
            ok: true,
            data: { priority: "urgent", request_type: "Contract review", title: "Review supplier terms" },
        });
        const audit = auditRows().filter((row) => row.action === "request.updated");
        expect(audit).toHaveLength(1);
        expectIdsOnly(audit[0], "Contract review");

        const refused = await updateRequest(db(), {
            ...as(PEOPLE.colleague),
            requestId: request.id,
            body: { priority: "low" },
        });
        expect(refused).toMatchObject({ ok: false, kind: "forbidden" });
    });

    it("sends status, assignment and the matter to their own operations", async () => {
        const request = await logRequest(PEOPLE.member);
        for (const body of [{ status: "closed" }, { assignee_email: null }, { project_id: null }, {}]) {
            const result = await updateRequest(db(), {
                ...as(PEOPLE.owner),
                requestId: request.id,
                body,
            });
            expect(result).toMatchObject({ ok: false, kind: "validation" });
        }
    });
});

describe("the activity trail", () => {
    it("lets any member comment, records ids only, and lists entries oldest first", async () => {
        const request = await logRequest(PEOPLE.colleague, {
            assignee_email: PEOPLE.colleague.email,
        });
        const added = await addRequestComment(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { body: "  Dana called again  " },
        });
        expect(added).toMatchObject({
            ok: true,
            data: { kind: "comment", body: "Dana called again", author: { user_id: PEOPLE.member.id } },
        });
        const audit = auditRows().filter((row) => row.action === "request.commented");
        expect(audit).toHaveLength(1);
        expectIdsOnly(audit[0], "Dana");

        const trail = await listRequestComments(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
        });
        expect(trail.ok && trail.data.map((entry) => [entry.kind, entry.event])).toEqual([
            ["system", "assigned"],
            ["comment", null],
        ]);

        const empty = await addRequestComment(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { body: "   " },
        });
        expect(empty).toMatchObject({ ok: false, kind: "validation" });
        const outsider = await listRequestComments(db(), {
            ...as(PEOPLE.outsider),
            requestId: request.id,
        });
        expect(outsider).toMatchObject({ ok: false, kind: "not_found" });
    });
});
