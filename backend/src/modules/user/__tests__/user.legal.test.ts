// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { brand } from "../../../lib/brand.generated";
import type { Db } from "../../../lib/supabase";
import {
    GATING_LEGAL_DOCUMENTS,
    loadOutstandingLegalAcceptances,
    parseLegalAcceptancePayload,
    recordLegalAcceptances,
    signInMethodFromUser,
} from "../user.legal";
import { serializeProfile } from "../user.profile.serialization";
import type { UserProfileRow } from "../user.profile.storage";
import type { RouterModelSelections } from "../../../lib/routerModels";

const TERMS_VERSION = brand.legalDocuments.terms.version;
const PRIVACY_VERSION = brand.legalDocuments.privacy.version;

interface FakeDbOptions {
    rows?: { document: string; version: string }[];
    selectError?: unknown;
    insertError?: unknown;
    user?: unknown;
}

function makeDb(opts: FakeDbOptions = {}) {
    const inserts: unknown[] = [];
    const db = {
        from(table: string) {
            const result =
                table === "user_legal_acceptances"
                    ? { data: opts.rows ?? [], error: opts.selectError ?? null }
                    : { data: [], error: null };
            const builder: Record<string, unknown> = {
                select: () => builder,
                eq: () => builder,
                in: () => builder,
                insert: (payload: unknown) => {
                    inserts.push(payload);
                    return Promise.resolve({ error: opts.insertError ?? null });
                },
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve(result).then(resolve, reject),
            };
            return builder;
        },
        auth: {
            admin: {
                getUserById: async () => ({
                    data: { user: opts.user ?? null },
                    error: null,
                }),
            },
        },
    };
    return { db: db as unknown as Db, inserts };
}

function profileRow(overrides: Partial<UserProfileRow>): UserProfileRow {
    return { onboarding_version: 1, ...overrides } as unknown as UserProfileRow;
}

const NO_ROUTER_MODELS = {} as unknown as RouterModelSelections;

describe("signInMethodFromUser", () => {
    it("maps email, google and SSO providers", () => {
        expect(signInMethodFromUser({ app_metadata: { provider: "email" } })).toBe(
            "password",
        );
        expect(signInMethodFromUser({ app_metadata: { provider: "google" } })).toBe(
            "google",
        );
        expect(
            signInMethodFromUser({ identities: [{ provider: "sso:acme" }] }),
        ).toBe("sso");
        expect(signInMethodFromUser(null)).toBe("unknown");
    });

    it("prefers google when the account links more than one provider", () => {
        expect(
            signInMethodFromUser({
                app_metadata: { provider: "email" },
                identities: [{ provider: "email" }, { provider: "google" }],
            }),
        ).toBe("google");
    });
});

describe("loadOutstandingLegalAcceptances", () => {
    it("owes both gating documents when nothing is accepted", async () => {
        const { db } = makeDb({ rows: [] });
        const result = await loadOutstandingLegalAcceptances(db, "u1");
        expect(result?.outstanding).toEqual([...GATING_LEGAL_DOCUMENTS]);
    });

    it("owes only privacy once terms is accepted at the current version", async () => {
        const { db } = makeDb({
            rows: [{ document: "terms", version: TERMS_VERSION }],
        });
        const result = await loadOutstandingLegalAcceptances(db, "u1");
        expect(result?.outstanding).toEqual(["privacy"]);
    });

    it("owes nothing once both are accepted at the current version", async () => {
        const { db } = makeDb({
            rows: [
                { document: "terms", version: TERMS_VERSION },
                { document: "privacy", version: PRIVACY_VERSION },
            ],
        });
        const result = await loadOutstandingLegalAcceptances(db, "u1");
        expect(result?.outstanding).toEqual([]);
    });

    it("still owes a document accepted only at an old version", async () => {
        const { db } = makeDb({
            rows: [
                { document: "terms", version: "0.0.1" },
                { document: "privacy", version: PRIVACY_VERSION },
            ],
        });
        const result = await loadOutstandingLegalAcceptances(db, "u1");
        expect(result?.outstanding).toEqual(["terms"]);
    });

    it("returns null (fail-open) when the query errors", async () => {
        const { db } = makeDb({ selectError: { message: "no such table" } });
        expect(await loadOutstandingLegalAcceptances(db, "u1")).toBeNull();
    });
});

describe("recordLegalAcceptances", () => {
    it("stores user, document, version and derived sign-in method", async () => {
        const { db, inserts } = makeDb({
            user: { app_metadata: { provider: "google" } },
        });
        const result = await recordLegalAcceptances(db, "u1", [
            { document: "terms", version: TERMS_VERSION },
            { document: "privacy", version: PRIVACY_VERSION },
        ]);
        expect(result.ok).toBe(true);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toEqual([
            {
                user_id: "u1",
                document: "terms",
                version: TERMS_VERSION,
                sign_in_method: "google",
            },
            {
                user_id: "u1",
                document: "privacy",
                version: PRIVACY_VERSION,
                sign_in_method: "google",
            },
        ]);
    });

    it("rejects an unknown document", async () => {
        const { db } = makeDb({});
        const result = await recordLegalAcceptances(db, "u1", [
            { document: "not-a-doc", version: "1.0.0" },
        ]);
        expect(result).toMatchObject({ ok: false, kind: "validation" });
    });

    it("rejects a stale version as a conflict", async () => {
        const { db } = makeDb({});
        const result = await recordLegalAcceptances(db, "u1", [
            { document: "terms", version: "0.0.1" },
        ]);
        expect(result).toMatchObject({ ok: false, kind: "conflict" });
    });

    it("reports an internal failure when the insert errors", async () => {
        const { db } = makeDb({ insertError: { message: "boom" } });
        const result = await recordLegalAcceptances(db, "u1", [
            { document: "terms", version: TERMS_VERSION },
        ]);
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });
});

describe("parseLegalAcceptancePayload", () => {
    it("accepts a well-formed body and dedupes documents", () => {
        const parsed = parseLegalAcceptancePayload({
            acceptances: [
                { document: "terms", version: "0.1.0" },
                { document: "terms", version: "0.1.0" },
                { document: "privacy", version: "0.1.0" },
            ],
        });
        expect(parsed).toEqual({
            ok: true,
            acceptances: [
                { document: "terms", version: "0.1.0" },
                { document: "privacy", version: "0.1.0" },
            ],
        });
    });

    it("rejects an empty or malformed body", () => {
        expect(parseLegalAcceptancePayload({}).ok).toBe(false);
        expect(parseLegalAcceptancePayload({ acceptances: [] }).ok).toBe(false);
        expect(
            parseLegalAcceptancePayload({ acceptances: [{ document: "terms" }] }).ok,
        ).toBe(false);
    });
});

describe("serializeProfile gating on legal acceptance", () => {
    it("is incomplete while a gating document is outstanding", () => {
        const profile = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ onboarding_version: 1 }),
            undefined,
            { outstanding: ["terms"] },
        );
        expect(profile.onboardingComplete).toBe(false);
        expect(profile.legalAcceptanceRequired).toEqual(["terms"]);
    });

    it("is complete once the personalisation steps and acceptance are done", () => {
        const profile = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ onboarding_version: 1 }),
            undefined,
            { outstanding: [] },
        );
        expect(profile.onboardingComplete).toBe(true);
        expect(profile.legalAcceptanceRequired).toEqual([]);
    });

    it("does not lock a user out when acceptance state is unknown", () => {
        const profile = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ onboarding_version: 1 }),
            undefined,
            null,
        );
        expect(profile.onboardingComplete).toBe(true);
    });

    it("stays incomplete when the personalisation steps are unfinished", () => {
        const profile = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ onboarding_version: null }),
            undefined,
            { outstanding: [] },
        );
        expect(profile.onboardingComplete).toBe(false);
    });
});
