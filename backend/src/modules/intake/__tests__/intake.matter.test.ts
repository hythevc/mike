// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

const projects = vi.hoisted(() => ({
    createProject: vi.fn(),
    deleteProject: vi.fn(),
}));
vi.mock("../../projects/projects.service", () => projects);

import { createMatterFromRequest, createRequest } from "../intake.service";
import {
    FIRM,
    PEOPLE,
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

/** What the projects facade would create: a private project in FIRM. */
function stubCreatedProject() {
    projects.createProject.mockImplementation(async (_db: Db, args: { name: string; org_id: string; userId: string }) => {
        const project = {
            id: "20000000-0000-4000-8000-000000000001",
            name: args.name,
            org_id: args.org_id,
            user_id: args.userId,
            visibility: "private",
            archived_at: null,
        };
        table("projects").push(project);
        return { ok: true, project: { ...project, access_role: "owner" } };
    });
    projects.deleteProject.mockResolvedValue({ ok: true });
}

async function logRequest(
    by: { id: string; email: string } = PEOPLE.member,
    body: Record<string, unknown> = {},
) {
    const result = await createRequest(db(), {
        ...as(by),
        body: { org_id: FIRM, title: "Acme distribution agreement", ...body },
    });
    if (!result.ok) throw new Error("create failed");
    return result.data;
}

beforeEach(() => {
    seedFirm();
    projects.createProject.mockReset();
    projects.deleteProject.mockReset();
    stubCreatedProject();
});

describe("creating a matter from a request", () => {
    it("creates the project in the request's organization through the projects facade and links it", async () => {
        const request = await logRequest();
        const result = await createMatterFromRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { cm_number: " 2026-014 " },
        });
        expect(projects.createProject).toHaveBeenCalledTimes(1);
        expect(projects.createProject.mock.calls[0][1]).toEqual({
            userId: PEOPLE.member.id,
            name: "Acme distribution agreement",
            cm_number: "2026-014",
            practice: undefined,
            org_id: FIRM,
            visibility: undefined,
        });
        expect(result).toMatchObject({
            ok: true,
            data: {
                changed: true,
                request: {
                    id: request.id,
                    matter: {
                        id: "20000000-0000-4000-8000-000000000001",
                        name: "Acme distribution agreement",
                        can_open: true,
                    },
                },
                comment: { kind: "system", event: "matter_created" },
                project: { id: "20000000-0000-4000-8000-000000000001" },
            },
        });
        const audit = auditRows().filter((row) => row.action === "request.matter_created");
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
            project_id: "20000000-0000-4000-8000-000000000001",
            title: null,
            surface: "intake",
            detail: { request_id: request.id },
        });
        expect(projects.deleteProject).not.toHaveBeenCalled();
    });

    it("refuses a viewer and a request that already has a matter", async () => {
        const request = await logRequest(PEOPLE.colleague);
        const viewer = await createMatterFromRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: {},
        });
        expect(viewer).toMatchObject({ ok: false, kind: "forbidden" });

        await createMatterFromRequest(db(), {
            ...as(PEOPLE.colleague),
            requestId: request.id,
            body: { name: "Acme" },
        });
        const again = await createMatterFromRequest(db(), {
            ...as(PEOPLE.owner),
            requestId: request.id,
            body: {},
        });
        expect(again).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "request_desk_matter_linked",
        });
        expect(projects.createProject).toHaveBeenCalledTimes(1);
    });

    it("removes its own project when another matter was linked first", async () => {
        const request = await logRequest();
        desk.beforeRpc = (fn) => {
            if (fn !== "request_desk_link_matter") return;
            const row = table("request_desk_requests").find((r) => r.id === request.id)!;
            row.project_id = "30000000-0000-4000-8000-000000000001";
        };
        const result = await createMatterFromRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: {},
        });
        expect(result).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "request_desk_matter_linked",
        });
        expect(projects.deleteProject).toHaveBeenCalledWith(expect.anything(), {
            projectId: "20000000-0000-4000-8000-000000000001",
            userId: PEOPLE.member.id,
            userEmail: PEOPLE.member.email,
        });
        expect(auditRows().filter((row) => row.action === "request.matter_created")).toHaveLength(0);
    });

    it("passes the projects facade's own refusal through", async () => {
        const request = await logRequest();
        projects.createProject.mockResolvedValueOnce({
            ok: false,
            kind: "validation",
            detail: "visibility must be private or organization",
        });
        const result = await createMatterFromRequest(db(), {
            ...as(PEOPLE.member),
            requestId: request.id,
            body: { visibility: "everyone" },
        });
        expect(result).toEqual({
            ok: false,
            kind: "validation",
            detail: "visibility must be private or organization",
        });
        expect(desk.rpcCalls.map((call) => call.fn)).not.toContain("request_desk_link_matter");
    });
});
