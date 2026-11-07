// SPDX-License-Identifier: AGPL-3.0-only
//
// A project chat turn in a matter whose client has switched AI off is refused
// with matter_ai_restricted before the stream starts, so no provider call is
// made (W18). The refusal is returned by prepareProjectChatStream, which runs
// entirely before the route's SSE loop.

import { describe, expect, it } from "vitest";
import type { Db } from "../../../lib/supabase";
import { prepareProjectChatStream } from "../projectChat.service";

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

const args = {
    userId: "u1",
    userEmail: undefined,
    projectId: "p1",
    messages: [{ role: "user" as const, content: "What does this say?" }],
    chatId: null,
    inputMessageId: null,
    displayed_doc: undefined,
    attached_documents: undefined,
    askInputsResponse: null,
    requestedModel: undefined,
    requestedReasoning: undefined,
};

describe("prepareProjectChatStream and a restricted matter", () => {
    it("refuses with matter_ai_restricted when the matter has AI switched off", async () => {
        // The creator opens their own personal project; the same row carries
        // ai_restricted so both checkProjectAccess and isMatterAiRestricted
        // read it without a provider call ever being reached.
        const db = fakeDb({
            projects: () => ({
                data: {
                    id: "p1",
                    user_id: "u1",
                    org_id: null,
                    visibility: "private",
                    archived_at: null,
                    ai_restricted: true,
                },
            }),
        });
        await expect(prepareProjectChatStream(db, args)).resolves.toMatchObject({
            ok: false,
            status: 403,
            code: "matter_ai_restricted",
        });
    });

    it("returns the existing 404 for a matter the caller cannot open", async () => {
        const db = fakeDb({ projects: () => ({ data: null }) });
        await expect(prepareProjectChatStream(db, args)).resolves.toMatchObject({
            ok: false,
            status: 404,
        });
    });
});
