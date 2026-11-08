// SPDX-License-Identifier: AGPL-3.0-only
//
// Tabular generation for a project review whose matter has AI switched off is
// refused with matter_ai_restricted before the lease is claimed and before any
// provider call (W18): prepareTabularGenerate returns the refusal.

import { describe, expect, it } from "vitest";
import type { Db } from "../../../lib/supabase";
import { prepareTabularGenerate, preparedGenerateFailure } from "../tabular.generate";

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

describe("prepareTabularGenerate and a restricted matter", () => {
    it("returns matter_restricted, which maps to the matter_ai_restricted code", async () => {
        const db = fakeDb({
            tabular_reviews: () => ({
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: "p1",
                    org_id: null,
                    model: "test-model",
                    columns_config: [{ name: "Term" }],
                },
            }),
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
        const prepared = await prepareTabularGenerate(db, {
            reviewId: "r1",
            userId: "u1",
            userEmail: undefined,
        });
        expect(prepared).toEqual({ ok: false, kind: "matter_restricted" });
        if (prepared.ok) throw new Error("expected refusal");
        expect(preparedGenerateFailure(prepared)).toMatchObject({
            ok: false,
            kind: "forbidden",
            code: "matter_ai_restricted",
        });
    });
});
