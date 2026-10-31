// SPDX-License-Identifier: AGPL-3.0-only
//
// The request desk over HTTP: which refusal becomes which status and code,
// who may change a request, and what a status change leaves behind. The
// database is the stateful fake in modules/intake/__tests__/deskDbFake.ts;
// the projects facade is the real one, so "create a matter" goes through the
// ordinary project creation and access rules.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    FIRM,
    OTHER_ORG,
    PEOPLE,
    PERSONAL_ORG,
    auditRows,
    seedFirm,
    table,
} from "../../modules/intake/__tests__/deskDbFake";

let currentUser: { id: string; email: string } = PEOPLE.member;

vi.mock("../../lib/supabase", async () => {
    const { deskClient } = await import("../../modules/intake/__tests__/deskDbFake.js");
    return { createServerSupabase: vi.fn(() => deskClient()) };
});

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = currentUser.id;
        res.locals.userEmail = currentUser.email;
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from "../../app";

/** The client's table of codes it acts on. */
const codeKinds = (() => {
    const source = readFileSync(
        resolve(__dirname, "../../../../frontend/src/shared/lib/userError.ts"),
        "utf8",
    );
    const start = source.indexOf("export const CODE_KINDS");
    return source.slice(start, source.indexOf("};", start));
})();

function expectListedCode(body: { code?: unknown }, code: string) {
    expect(body.code).toBe(code);
    expect(codeKinds).toMatch(new RegExp(`\\n\\s+${code}: "`));
}

const as = (person: { id: string; email: string }) => {
    currentUser = person;
    return request(app);
};

type Person = { id: string; email: string };

async function logRequest(by: Person = PEOPLE.colleague, body: Record<string, unknown> = {}) {
    const response = await as(by)
        .post("/intake/requests")
        .send({ org_id: FIRM, title: "Board minutes for the March meeting", ...body });
    expect(response.status).toBe(201);
    return response.body as { id: string; reference: string };
}

beforeEach(() => {
    seedFirm();
    currentUser = PEOPLE.member;
});

describe("the Personal workspace", () => {
    it("has no request desk: list, board and create answer 400 with a CODE_KINDS code", async () => {
        const list = await as(PEOPLE.member).get("/intake/requests?workspace=personal");
        expect(list.status).toBe(400);
        expectListedCode(list.body, "request_desk_org_only");

        const board = await as(PEOPLE.member).get("/intake/board");
        expect(board.status).toBe(400);
        expectListedCode(board.body, "request_desk_org_only");

        for (const org_id of [null, "personal", PERSONAL_ORG]) {
            const create = await as(PEOPLE.member)
                .post("/intake/requests")
                .send({ org_id, title: "Lease review" });
            expect(create.status).toBe(400);
            expectListedCode(create.body, "request_desk_org_only");
        }
        expect(table("request_desk_requests")).toHaveLength(0);
    });

    it("answers an organization the caller is not in as a missing workspace", async () => {
        const list = await as(PEOPLE.member).get(`/intake/requests?workspace=${OTHER_ORG}`);
        expect(list.status).toBe(404);
        expect(list.body).toEqual({ code: "workspace_not_found", detail: "Workspace not found" });
    });
});

describe("assignment", () => {
    it("refuses a non-member with 400 and a CODE_KINDS code, and assigns a member", async () => {
        const created = await logRequest();
        const refused = await as(PEOPLE.admin)
            .put(`/intake/requests/${created.id}/assignee`)
            .send({ assignee_email: PEOPLE.outsider.email });
        expect(refused.status).toBe(400);
        expectListedCode(refused.body, "request_desk_assignee_not_member");
        expect(table("request_desk_comments")).toHaveLength(0);

        const assigned = await as(PEOPLE.admin)
            .put(`/intake/requests/${created.id}/assignee`)
            .send({ assignee_email: PEOPLE.member.email });
        expect(assigned.status).toBe(200);
        expect(assigned.body.request.assignee).toMatchObject({
            user_id: PEOPLE.member.id,
            email: PEOPLE.member.email,
            is_member: true,
        });
    });

    it("lets a viewer take an unassigned request but not hand one to someone else", async () => {
        const created = await logRequest();
        const handOff = await as(PEOPLE.member)
            .put(`/intake/requests/${created.id}/assignee`)
            .send({ assignee_email: PEOPLE.owner.email });
        expect(handOff.status).toBe(403);

        const take = await as(PEOPLE.member)
            .put(`/intake/requests/${created.id}/assignee`)
            .send({ assignee_email: PEOPLE.member.email });
        expect(take.status).toBe(200);
        expect(take.body.request.access_role).toBe("editor");
    });
});

describe("status changes", () => {
    it("are refused to a viewer with 403, writing nothing", async () => {
        const created = await logRequest(PEOPLE.colleague);
        const response = await as(PEOPLE.member)
            .post(`/intake/requests/${created.id}/status`)
            .send({ status: "in_progress" });
        expect(response.status).toBe(403);
        expect(response.body.detail).toMatch(/assignee/);
        expect(table("request_desk_comments")).toHaveLength(0);
        expect(table("request_desk_requests")[0].status).toBe("new");

        const read = await as(PEOPLE.member).get(`/intake/requests/${created.id}`);
        expect(read.status).toBe(200);
        expect(read.body.access_role).toBe("viewer");
    });

    it("write one status_change entry and one ids-only audit row each, setting and clearing closed_at", async () => {
        const created = await logRequest(PEOPLE.colleague);
        const audits = () => auditRows().filter((row) => row.action === "request.status_changed");

        const closed = await as(PEOPLE.colleague)
            .post(`/intake/requests/${created.id}/status`)
            .send({ status: "declined", note: "Not a legal question" });
        expect(closed.status).toBe(200);
        expect(closed.body).toMatchObject({
            changed: true,
            request: { status: "declined", is_overdue: false },
            comment: { kind: "status_change", from_status: "new", to_status: "declined" },
        });
        expect(closed.body.request.closed_at).toEqual(expect.any(String));
        expect(audits()).toHaveLength(1);
        expect(audits()[0]).toMatchObject({
            user_id: PEOPLE.colleague.id,
            org_id: FIRM,
            surface: "intake",
            title: null,
            detail: { request_id: created.id, comment_id: closed.body.comment.id },
        });
        expect(JSON.stringify(audits()[0])).not.toContain("legal question");

        const repeat = await as(PEOPLE.colleague)
            .post(`/intake/requests/${created.id}/status`)
            .send({ status: "declined" });
        expect(repeat.body).toMatchObject({ changed: false, comment: null });

        const reopened = await as(PEOPLE.owner)
            .post(`/intake/requests/${created.id}/status`)
            .send({ status: "new" });
        expect(reopened.body.request.closed_at).toBeNull();

        expect(
            table("request_desk_comments").filter((row) => row.kind === "status_change"),
        ).toHaveLength(2);
        expect(audits()).toHaveLength(2);

        const trail = await as(PEOPLE.member).get(`/intake/requests/${created.id}/comments`);
        expect(trail.status).toBe(200);
        expect(trail.body.map((entry: { to_status: string }) => entry.to_status)).toEqual([
            "declined",
            "new",
        ]);
    });

    it("answer 409 with a code when the request moved meanwhile", async () => {
        const created = await logRequest(PEOPLE.colleague);
        await as(PEOPLE.owner)
            .post(`/intake/requests/${created.id}/status`)
            .send({ status: "waiting" });
        const response = await as(PEOPLE.colleague)
            .post(`/intake/requests/${created.id}/status`)
            .send({ status: "in_progress", expected_status: "new" });
        expect(response.status).toBe(409);
        expectListedCode(response.body, "request_desk_status_conflict");
    });
});

describe("create a matter from a request", () => {
    it("creates a private project in the organization, links it, and shows its name only to people who can open it", async () => {
        const created = await logRequest(PEOPLE.colleague);
        const response = await as(PEOPLE.colleague)
            .post(`/intake/requests/${created.id}/matter`)
            .send({});
        expect(response.status).toBe(201);
        const project = table("projects")[0];
        expect(project).toMatchObject({
            org_id: FIRM,
            user_id: PEOPLE.colleague.id,
            visibility: "private",
            name: "Board minutes for the March meeting",
        });
        expect(response.body.request.matter).toEqual({
            id: project.id,
            name: "Board minutes for the March meeting",
            can_open: true,
        });
        expect(
            auditRows().filter(
                (row) => row.action === "request.matter_created" && row.project_id === project.id,
            ),
        ).toHaveLength(1);

        // Linked, but private to its creator: other members, the
        // organization's admins included, see that a matter exists and
        // nothing about it.
        for (const person of [PEOPLE.member, PEOPLE.admin]) {
            const read = await as(person).get(`/intake/requests/${created.id}`);
            expect(read.body.matter).toEqual({ id: project.id, name: null, can_open: false });
        }

        const again = await as(PEOPLE.owner)
            .post(`/intake/requests/${created.id}/matter`)
            .send({});
        expect(again.status).toBe(409);
        expectListedCode(again.body, "request_desk_matter_linked");
        expect(table("projects")).toHaveLength(1);
    });

    it("is refused to a viewer", async () => {
        const created = await logRequest(PEOPLE.colleague);
        const response = await as(PEOPLE.member)
            .post(`/intake/requests/${created.id}/matter`)
            .send({});
        expect(response.status).toBe(403);
        expect(table("projects")).toHaveLength(0);
    });
});

describe("reading", () => {
    it("lists the organization's requests for a member and hides them from everyone else", async () => {
        const first = await logRequest(PEOPLE.colleague, { priority: "urgent" });
        await logRequest(PEOPLE.member);

        const page = await as(PEOPLE.member).get(
            `/intake/requests?workspace=${FIRM}&sort_key=priority`,
        );
        expect(page.status).toBe(200);
        expect(page.body).toMatchObject({ total: 2, limit: 20, offset: 0 });
        // Highest priority first, ahead of the newer reference.
        expect(page.body.requests.map((r: { reference: string }) => r.reference)).toEqual([
            "REQ-1",
            "REQ-2",
        ]);
        const newest = await as(PEOPLE.member).get(`/intake/requests?workspace=${FIRM}`);
        expect(newest.body.requests.map((r: { reference: string }) => r.reference)).toEqual([
            "REQ-2",
            "REQ-1",
        ]);

        const board = await as(PEOPLE.member).get(`/intake/board?workspace=${FIRM}`);
        expect(board.status).toBe(200);
        expect(board.body).toMatchObject({
            org_id: FIRM,
            total: 2,
            open: 2,
            by_status: { new: 2 },
            open_by_priority: { urgent: 1, normal: 1 },
        });

        const outsider = await as(PEOPLE.outsider).get(`/intake/requests/${first.id}`);
        expect(outsider.status).toBe(404);
        const malformed = await as(PEOPLE.member).get("/intake/requests/REQ-1");
        expect(malformed.status).toBe(404);
        const comment = await as(PEOPLE.outsider)
            .post(`/intake/requests/${first.id}/comments`)
            .send({ body: "hello" });
        expect(comment.status).toBe(404);
    });

    it("lets a viewer comment", async () => {
        const created = await logRequest(PEOPLE.colleague);
        const response = await as(PEOPLE.member)
            .post(`/intake/requests/${created.id}/comments`)
            .send({ body: "I have the signed copy." });
        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
            kind: "comment",
            body: "I have the signed copy.",
            author: { user_id: PEOPLE.member.id },
        });
    });
});
