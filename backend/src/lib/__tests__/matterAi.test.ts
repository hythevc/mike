// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Db } from "../supabase";
import {
    assertDocumentsAllowAi,
    assertMatterAllowsAi,
    isMatterAiRestricted,
    MATTER_AI_RESTRICTED_CODE,
    MatterAiRestrictedError,
    matterAiRestrictedError,
    restrictedMatterAmongDocuments,
} from "../matterAi";

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
            limit: () => builder,
            order: () => builder,
            maybeSingle: settle,
            single: settle,
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                settle().then(resolve, reject),
        };
        return builder;
    };
    return { from } as unknown as Db;
}

describe("isMatterAiRestricted", () => {
    it("is false for a matter with AI on", async () => {
        const db = fakeDb({ projects: () => ({ data: { ai_restricted: false } }) });
        expect(await isMatterAiRestricted(db, "p1")).toBe(false);
    });

    it("is true for a matter with AI off", async () => {
        const db = fakeDb({ projects: () => ({ data: { ai_restricted: true } }) });
        expect(await isMatterAiRestricted(db, "p1")).toBe(true);
    });

    it("is false when there is no matter", async () => {
        // No query runs: a null id resolves without touching the database.
        const db = fakeDb({
            projects: () => {
                throw new Error("should not query");
            },
        });
        expect(await isMatterAiRestricted(db, null)).toBe(false);
        expect(await isMatterAiRestricted(db, undefined)).toBe(false);
    });

    it("throws on a read failure rather than waving the matter through", async () => {
        const db = fakeDb({ projects: () => ({ data: null, error: { message: "boom" } }) });
        await expect(isMatterAiRestricted(db, "p1")).rejects.toThrow(
            /matter's AI setting/i,
        );
    });
});

describe("assertMatterAllowsAi", () => {
    it("resolves when the matter allows AI", async () => {
        const db = fakeDb({ projects: () => ({ data: { ai_restricted: false } }) });
        await expect(assertMatterAllowsAi(db, "p1")).resolves.toBeUndefined();
    });

    it("throws a coded MatterAiRestrictedError when AI is off", async () => {
        const db = fakeDb({ projects: () => ({ data: { ai_restricted: true } }) });
        const error = await assertMatterAllowsAi(db, "p1").catch((e) => e);
        expect(error).toBeInstanceOf(MatterAiRestrictedError);
        expect((error as MatterAiRestrictedError).code).toBe(MATTER_AI_RESTRICTED_CODE);
        expect((error as MatterAiRestrictedError).projectId).toBe("p1");
    });

    it("is a no-op for a turn with no matter", async () => {
        const db = fakeDb({});
        await expect(assertMatterAllowsAi(db, null)).resolves.toBeUndefined();
    });
});

describe("restrictedMatterAmongDocuments", () => {
    it("finds the restricted matter an attached document belongs to", async () => {
        const db = fakeDb({
            documents: () => ({ data: [{ project_id: "p1" }, { project_id: null }] }),
            projects: () => ({ data: [{ id: "p1" }] }),
        });
        expect(await restrictedMatterAmongDocuments(db, ["d1", "d2"])).toBe("p1");
    });

    it("returns null when no attached document is in a restricted matter", async () => {
        const db = fakeDb({
            documents: () => ({ data: [{ project_id: "p1" }] }),
            projects: () => ({ data: [] }),
        });
        expect(await restrictedMatterAmongDocuments(db, ["d1"])).toBeNull();
    });

    it("returns null without querying when no document ids are given", async () => {
        const db = fakeDb({
            documents: () => {
                throw new Error("should not query");
            },
        });
        expect(await restrictedMatterAmongDocuments(db, [])).toBeNull();
        expect(await restrictedMatterAmongDocuments(db, [null, undefined])).toBeNull();
    });

    it("returns null when the documents belong to no matter", async () => {
        const db = fakeDb({
            documents: () => ({ data: [{ project_id: null }] }),
        });
        expect(await restrictedMatterAmongDocuments(db, ["d1"])).toBeNull();
    });

    it("throws on a read failure", async () => {
        const db = fakeDb({
            documents: () => ({ data: null, error: { message: "boom" } }),
        });
        await expect(restrictedMatterAmongDocuments(db, ["d1"])).rejects.toThrow(
            /documents' matters/i,
        );
    });
});

describe("assertDocumentsAllowAi", () => {
    it("throws when an attached document belongs to a restricted matter", async () => {
        const db = fakeDb({
            documents: () => ({ data: [{ project_id: "p1" }] }),
            projects: () => ({ data: [{ id: "p1" }] }),
        });
        await expect(assertDocumentsAllowAi(db, ["d1"])).rejects.toBeInstanceOf(
            MatterAiRestrictedError,
        );
    });

    it("resolves when no attached document is restricted", async () => {
        const db = fakeDb({
            documents: () => ({ data: [{ project_id: "p1" }] }),
            projects: () => ({ data: [] }),
        });
        await expect(assertDocumentsAllowAi(db, ["d1"])).resolves.toBeUndefined();
    });
});

describe("matterAiRestrictedError", () => {
    it("recognises the error directly and through a cause chain", () => {
        const restricted = new MatterAiRestrictedError("p1");
        expect(matterAiRestrictedError(restricted)).toBe(restricted);
        const wrapped = new Error("outer", { cause: restricted });
        expect(matterAiRestrictedError(wrapped)).toBe(restricted);
        expect(matterAiRestrictedError(new Error("unrelated"))).toBeNull();
        expect(matterAiRestrictedError(null)).toBeNull();
    });
});
