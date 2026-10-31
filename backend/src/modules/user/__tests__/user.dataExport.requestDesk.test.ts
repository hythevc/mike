// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../user.dataExport";
import { makeExportDb, type Row } from "./user.dataExport.fixture";

const userId = "requester-user";
const email = "requester@example.test";
const ids = (rows: Row[]) => rows.map((row) => row.id);

function fixtures(memberOf: string[] = ["firm"]): Record<string, Row[]> {
    return {
        org_members: memberOf.map((org_id) => ({ org_id, user_id: userId, role: "member" })),
        request_desk_requests: [
            { id: "logged", org_id: "firm", reference_number: 3, created_by: userId, assignee_user_id: "colleague" },
            { id: "assigned", org_id: "firm", reference_number: 1, created_by: "colleague", assignee_user_id: userId },
            { id: "both", org_id: "firm", reference_number: 2, created_by: userId, assignee_user_id: userId },
            { id: "colleagues", org_id: "firm", reference_number: 4, created_by: "colleague", assignee_user_id: null },
            { id: "elsewhere", org_id: "other-firm", reference_number: 1, created_by: userId, assignee_user_id: userId },
        ],
        request_desk_comments: [
            { id: "on-colleagues", org_id: "firm", request_id: "colleagues", author_user_id: userId, kind: "comment", created_at: "t2" },
            { id: "status", org_id: "firm", request_id: "logged", author_user_id: userId, kind: "status_change", created_at: "t1" },
            { id: "not-mine", org_id: "firm", request_id: "logged", author_user_id: "colleague", kind: "comment", created_at: "t3" },
            { id: "other-firm", org_id: "other-firm", request_id: "elsewhere", author_user_id: userId, kind: "comment", created_at: "t4" },
        ],
    };
}

describe("account export: request desk", () => {
    it("carries, in an organization's export, the requests a person logged or is assigned and the entries they wrote", async () => {
        const { db } = makeExportDb(fixtures());
        const firm = await buildUserAccountExport(db, userId, email, "firm");

        expect(ids(firm.request_desk.requests)).toEqual(["assigned", "both", "logged"]);
        expect(ids(firm.request_desk.comments)).toEqual(["on-colleagues", "status"]);
    });

    it("leaves the request desk out of the Personal export", async () => {
        const { db } = makeExportDb(fixtures());
        const personal = await buildUserAccountExport(db, userId, email, null);
        expect(personal.request_desk).toEqual({ requests: [], comments: [] });
    });

    it("carries nothing once the person has left the organization", async () => {
        const { db } = makeExportDb(fixtures([]));
        const firm = await buildUserAccountExport(db, userId, email, "firm");
        expect(firm.request_desk).toEqual({ requests: [], comments: [] });
    });
});
