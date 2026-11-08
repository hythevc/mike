// SPDX-License-Identifier: AGPL-3.0-only
//
// An assistant turn that attaches a document from a matter whose client has
// switched AI off is refused with matter_ai_restricted before the stream
// starts, so no provider call is made (W18). prepareChatStream returns the
// refusal; the scripts hold no insert, so a stored message would be an
// unexpected query.

import { describe, expect, it } from "vitest";
import type { Db } from "../../../lib/supabase";
import { prepareChatStream } from "../chat.prepare";

type Result = { data: unknown; error?: unknown };

function fakeDb(handlers: Record<string, () => Result>): Db {
    const from = (table: string) => {
        const settle = () =>
            Promise.resolve(handlers[table]?.() ?? { data: null, error: null });
        const builder: Record<string, unknown> = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            is: () => builder,
            or: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: settle,
            single: settle,
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                settle().then(resolve, reject),
        };
        return builder;
    };
    return { from } as unknown as Db;
}

const turn = {
    userId: "u1",
    userEmail: "u1@example.com",
    messages: [
        {
            role: "user" as const,
            content: "Summarise this",
            files: [{ filename: "f.pdf", document_id: "d1" }],
        },
    ],
    chatId: null,
    inputMessageId: null,
    projectIdProvided: false,
    projectId: null,
    askInputsResponse: null,
    requestedModel: undefined,
    requestedReasoning: undefined,
};

describe("prepareChatStream and an attachment from a restricted matter", () => {
    it("refuses with matter_ai_restricted", async () => {
        // The attachment is in-workspace (personal), so the workspace check
        // passes and the matter check is reached. Its matter has AI off.
        const db = fakeDb({
            // d1 belongs to the personal matter p1.
            documents: () => ({
                data: [{ id: "d1", project_id: "p1", workflow_id: null, org_id: null }],
            }),
            // p1 is a personal project (org_id null) with AI switched off.
            projects: () => ({ data: [{ id: "p1", org_id: null }] }),
            organizations: () => ({ data: [] }),
        });
        await expect(prepareChatStream(db, turn)).resolves.toMatchObject({
            ok: false,
            status: 403,
            code: "matter_ai_restricted",
        });
    });
});
