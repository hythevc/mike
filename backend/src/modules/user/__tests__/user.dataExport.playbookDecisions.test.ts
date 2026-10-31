// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../user.dataExport";
import { makeExportDb, type Row } from "./user.dataExport.fixture";

const userId = "reviewer";
const email = "reviewer@example.test";
const ids = (rows: Row[]) => rows.map((row) => row.id);

function playbook(id: string, fields: Row = {}): Row {
    return {
        id,
        user_id: userId,
        org_id: null,
        visibility: "private",
        content_json: { name: id },
        ...fields,
    };
}

function decision(id: string, runId: string, fields: Row = {}): Row {
    return {
        id,
        run_id: runId,
        finding_key: `finding-${id}`,
        decision: "accepted",
        method: "single",
        note: null,
        escalated_to: null,
        decided_by: userId,
        decided_at: "2026-10-31T10:00:00.000Z",
        ...fields,
    };
}

describe("account export of playbook decisions", () => {
    it("carries the decisions on the runs it exports, notes included, and only those", async () => {
        const { db } = makeExportDb({
            org_members: [{ org_id: "current-org", user_id: userId, role: "member" }],
            playbooks: [
                playbook("playbook-personal"),
                playbook("playbook-current", {
                    org_id: "current-org",
                    visibility: "organization",
                }),
                // The reviewer left this organization: its runs stay there.
                playbook("playbook-departed", {
                    org_id: "old-org",
                    visibility: "organization",
                }),
            ],
            playbook_runs: [
                { id: "run-personal", playbook_id: "playbook-personal", user_id: userId },
                { id: "run-current", playbook_id: "playbook-current", user_id: userId },
                { id: "run-departed", playbook_id: "playbook-departed", user_id: userId },
                { id: "run-by-colleague", playbook_id: "playbook-personal", user_id: "colleague" },
            ],
            playbook_finding_decisions: [
                decision("decision-override", "run-personal", {
                    decision: "overridden",
                    note: "Agreed with the client on the call.",
                }),
                decision("decision-escalation", "run-personal", {
                    decision: "escalated",
                    escalated_to: "colleague",
                }),
                decision("decision-bulk", "run-personal", { method: "bulk" }),
                decision("decision-firm", "run-current"),
                decision("decision-departed", "run-departed"),
                decision("decision-colleague", "run-by-colleague", {
                    decided_by: "colleague",
                }),
            ],
        });

        const personal = await buildUserAccountExport(db, userId, email, null);

        expect(ids(personal.playbook_runs)).toEqual(["run-personal"]);
        expect(ids(personal.playbook_finding_decisions)).toEqual([
            "decision-override",
            "decision-escalation",
            "decision-bulk",
        ]);
        expect(personal.playbook_finding_decisions[0]).toMatchObject({
            run_id: "run-personal",
            decision: "overridden",
            note: "Agreed with the client on the call.",
        });
        expect(personal.playbook_finding_decisions[1]).toMatchObject({
            decision: "escalated",
            escalated_to: "colleague",
        });

        const firm = await buildUserAccountExport(db, userId, email, "current-org");

        expect(ids(firm.playbook_runs)).toEqual(["run-current"]);
        expect(ids(firm.playbook_finding_decisions)).toEqual(["decision-firm"]);
    });

    it("has no decisions to export without runs", async () => {
        const { db } = makeExportDb({
            playbook_finding_decisions: [decision("stray", "someone-elses-run")],
        });

        const result = await buildUserAccountExport(db, userId, email, null);

        expect(result.playbook_runs).toEqual([]);
        expect(result.playbook_finding_decisions).toEqual([]);
    });
});
