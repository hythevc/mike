// SPDX-License-Identifier: AGPL-3.0-only
//
// A Word turn that attaches a document from a matter whose client has switched
// AI off is refused with matter_ai_restricted before any provider call (W18).
// Word chats are Personal-only, so the matter is reached through the attached
// documents: prepareWordChatStream returns the refusal, and the route maps it
// to 403. The scripts hold no insert, so persistence is never reached.

import { describe, expect, it } from "vitest";
import type { Db } from "../../../lib/supabase";
import { prepareWordChatStream } from "../wordChat.service";

type Result = { data: unknown; error?: unknown };

/** A loose fake: each table answers with canned data, whatever the query. */
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
    chatId: null,
    messages: [
        {
            role: "user" as const,
            content: "Tidy this clause",
            files: [{ filename: "draft.docx", document_id: "d1" }],
        },
    ],
    clientDocumentId: "word-document",
    activeDocumentName: "Draft",
    documentContext: undefined,
    // A cloud chat would persist; the gate fires first either way, and the
    // scripts carry no insert so a write would be an unexpected query.
    persistChat: true,
    clientToolsEnabled: false,
    requestedModel: null,
    requestedReasoning: undefined,
};

describe("prepareWordChatStream and an attachment from a restricted matter", () => {
    it("refuses with matter_ai_restricted before any provider call", async () => {
        // d1 is a personal document (org_id null) in matter p1, so the
        // Personal-only workspace check passes and the matter check is reached.
        // The same p1 row answers the "AI switched off" query, so the turn is
        // refused before persistence or the stream.
        const db = fakeDb({
            documents: () => ({
                data: [{ id: "d1", project_id: "p1", workflow_id: null, org_id: null }],
            }),
            projects: () => ({ data: [{ id: "p1", org_id: null }] }),
            organizations: () => ({ data: [] }),
        });
        await expect(prepareWordChatStream(db, turn)).resolves.toMatchObject({
            ok: false,
            status: 403,
            code: "matter_ai_restricted",
        });
    });
});
