// SPDX-License-Identifier: AGPL-3.0-only
//
// The matter jurisdiction profile over HTTP (L1): the registry endpoint, the
// three fields on project create, read and update, the organization defaults
// a new matter starts with, the audit row a change writes, and who may read
// or change any of it.
//
// The database is the in-memory stand-in from helpers/memoryDb.ts, so the
// real access checks (lib/access.ts) decide every verdict from the rows
// seeded below, and each test can see what a request left behind. Sessions
// are named by an `x-test-user` header; a request without one has none.
//
// The profile is off unless a deployment turns it on, so every test here
// runs with MATTER_JURISDICTIONS_ENABLED=true except the last block, which
// pins that a deployment that has not turned it on answers as before.

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDbFunction, type Row } from "../helpers/memoryDb";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => holder.db,
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        req: { get(name: string): string | undefined },
        res: {
            locals: Record<string, unknown>;
            status(code: number): { json(body: unknown): void };
        },
        next: () => void,
    ) => {
        const user = req.get("x-test-user");
        if (!user) {
            res.status(401).json({ detail: "Invalid or expired session" });
            return;
        }
        res.locals.userId = user;
        res.locals.userEmail = `${user}@example.test`;
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

import { listLaunchJurisdictions } from "../../lib/jurisdictions";
import { RESPONSE_LANGUAGES } from "../../lib/responseLanguages";
import { orgsRouter } from "../../modules/orgs/orgs.routes";
import { projectsRouter } from "../../modules/projects/projects.routes";

const app = express();
app.use(express.json());
app.use("/projects", projectsRouter);
app.use("/orgs", orgsRouter);

// Two firms and one person on their own.
const ORG_A = "org-a";
const ORG_B = "org-b";
const ORG_PERSONAL = "org-personal-carol";
const ALICE = "alice"; // owner of ORG_A
const ADAM = "adam"; // admin of ORG_A
const MIA = "mia"; // member of ORG_A
const BOB = "bob"; // owner of ORG_B
const CAROL = "carol"; // in no firm

const T0 = "2026-11-01T00:00:00.000Z";
const EMPTY_PROFILE = {
    jurisdictions: [],
    governing_law: null,
    working_language: null,
};
const ALL_CODES = listLaunchJurisdictions().map((j) => j.code);

function project(row: Row): Row {
    return {
        cm_number: null,
        practice: null,
        org_id: null,
        visibility: "private",
        archived_at: null,
        ...EMPTY_PROFILE,
        created_at: T0,
        updated_at: T0,
        ...row,
    };
}

let created = 0;
const functions: Record<string, MemoryDbFunction> = {
    // The project and its memory setting in one statement, as the real
    // function does; it knows nothing of the jurisdiction columns.
    create_project_with_memory(args, tables) {
        const row = project({
            id: `p-new-${++created}`,
            user_id: args.p_user_id,
            name: args.p_name,
            cm_number: args.p_cm_number ?? null,
            practice: args.p_practice ?? null,
            org_id: args.p_org_id ?? null,
        });
        (tables.projects ??= []).push(row);
        return { data: { ...row }, error: null };
    },
    // The list function returns a fixed set of columns, none of them the
    // jurisdiction profile: what the caller created, and their firms' public
    // projects.
    get_projects_overview(args, tables) {
        const firms = (tables.org_members ?? [])
            .filter((member) => member.user_id === args.p_user_id)
            .map((member) => member.org_id);
        const rows = (tables.projects ?? [])
            .filter(
                (row) =>
                    row.user_id === args.p_user_id ||
                    (firms.includes(row.org_id) &&
                        row.visibility === "organization"),
            )
            .map((row) => ({
                id: row.id,
                user_id: row.user_id,
                org_id: row.org_id,
                access_scope:
                    row.visibility === "organization" ? "organization" : "private",
                organization_name:
                    (tables.organizations ?? []).find((o) => o.id === row.org_id)
                        ?.name ?? null,
                name: row.name,
                practice: row.practice,
            }));
        return { data: rows, error: null };
    },
    // The lightweight list: a name and little else, for the same projects.
    get_project_summaries(args, tables) {
        const firms = (tables.org_members ?? [])
            .filter((member) => member.user_id === args.p_user_id)
            .map((member) => member.org_id);
        const rows = (tables.projects ?? [])
            .filter(
                (row) =>
                    row.user_id === args.p_user_id ||
                    (firms.includes(row.org_id) &&
                        row.visibility === "organization"),
            )
            .map((row) => ({ id: row.id, name: row.name, org_id: row.org_id }));
        return { data: rows, error: null };
    },
    org_item_is_ownerless: () => ({ data: false, error: null }),
    org_private_access_role: () => ({ data: null, error: null }),
    ownerless_org_item_ids: () => ({ data: [], error: null }),
};

function seed() {
    created = 0;
    const fake = memoryDb({
        functions,
        tables: {
            organizations: [
                {
                    id: ORG_A,
                    name: "Alpha LLP",
                    kind: "team",
                    deleted_at: null,
                    default_jurisdictions: ["GB", "EU"],
                    default_working_language: "en-GB",
                },
                {
                    id: ORG_B,
                    name: "Beta Advogados",
                    kind: "team",
                    deleted_at: null,
                    default_jurisdictions: ["BR", "BR_SP"],
                    default_working_language: "pt-BR",
                },
                {
                    id: ORG_PERSONAL,
                    name: "Carol",
                    kind: "personal",
                    deleted_at: null,
                    default_jurisdictions: [],
                    default_working_language: null,
                },
            ],
            org_members: [
                { id: "m1", org_id: ORG_A, user_id: ALICE, role: "owner" },
                { id: "m2", org_id: ORG_A, user_id: ADAM, role: "admin" },
                { id: "m3", org_id: ORG_A, user_id: MIA, role: "member" },
                { id: "m4", org_id: ORG_B, user_id: BOB, role: "owner" },
                { id: "m5", org_id: ORG_PERSONAL, user_id: CAROL, role: "owner" },
            ],
            projects: [
                // Alice's, open to all of Alpha LLP.
                project({
                    id: "p-alpha",
                    user_id: ALICE,
                    org_id: ORG_A,
                    name: "Alpha matter",
                    visibility: "organization",
                    jurisdictions: ["PT", "EU"],
                    governing_law: "PT",
                    working_language: "pt-PT",
                }),
                // Bob's, open to all of Beta Advogados.
                project({
                    id: "p-beta",
                    user_id: BOB,
                    org_id: ORG_B,
                    name: "Beta matter",
                    visibility: "organization",
                    jurisdictions: ["BR"],
                    governing_law: "BR",
                    working_language: "pt-BR",
                }),
                // Carol's own, with nothing recorded.
                project({ id: "p-carol", user_id: CAROL, name: "Carol matter" }),
            ],
        },
    });
    holder.db = fake.db;
    return fake;
}

let fake: ReturnType<typeof seed>;
const as = (user: string) => ["x-test-user", user] as const;
const stored = (id: string) =>
    fake.tables.projects.find((row) => row.id === id) as Row;
const profileOf = (row: Row) => ({
    jurisdictions: row.jurisdictions,
    governing_law: row.governing_law,
    working_language: row.working_language,
});
const audits = () => fake.tables.audit_events ?? [];

beforeEach(() => {
    vi.stubEnv("MATTER_JURISDICTIONS_ENABLED", "true");
    fake = seed();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("GET /projects/jurisdictions", () => {
    it("requires a session", async () => {
        const res = await request(app).get("/projects/jurisdictions");
        expect(res.status).toBe(401);
        expect(res.body).not.toHaveProperty("jurisdictions");
    });

    it("returns the 29 launch jurisdictions to any signed-in user", async () => {
        for (const user of [ALICE, MIA, BOB, CAROL, "someone-new"]) {
            const res = await request(app)
                .get("/projects/jurisdictions")
                .set(...as(user));
            expect(res.status).toBe(200);
            expect(res.body.jurisdictions).toHaveLength(29);
            expect(
                res.body.jurisdictions.map((j: { code: string }) => j.code),
            ).toEqual(ALL_CODES);
        }
    });

    it("gives each entry its code, name, kind, parent and languages, and nothing else", async () => {
        const res = await request(app)
            .get("/projects/jurisdictions")
            .set(...as(CAROL));
        expect(res.body.jurisdictions).toEqual(
            listLaunchJurisdictions().map((j) => ({
                code: j.code,
                name: j.name,
                kind: j.kind,
                parent: j.parent,
                languages: [...j.languages],
            })),
        );
        expect(res.body.jurisdictions[1]).toEqual({
            code: "US_CA",
            name: "California",
            kind: "subdivision",
            parent: "US",
            languages: ["en"],
        });
    });

    it("lists the working languages a matter can use and the jurisdiction limit", async () => {
        const res = await request(app)
            .get("/projects/jurisdictions")
            .set(...as(CAROL));
        expect(res.body.max_jurisdictions).toBe(10);
        expect(res.body.working_languages).toEqual(
            Object.entries(RESPONSE_LANGUAGES).map(([code, name]) => ({
                code,
                name,
            })),
        );
        // The automatic setting is a personal preference, not a language.
        expect(
            res.body.working_languages.map((l: { code: string }) => l.code),
        ).not.toContain("auto");
    });

    it("is not read as a project id and reads nothing from the database", async () => {
        await request(app).get("/projects/jurisdictions").set(...as(CAROL)).expect(200);
        expect(fake.calls).toEqual([]);
        expect(fake.rpcCalls).toEqual([]);
    });
});

describe("POST /projects with a jurisdiction profile", () => {
    it("stores and returns the three fields", async () => {
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({
                name: "Cross-border sale",
                jurisdictions: ["PT", "ES", "EU"],
                governing_law: "PT",
                working_language: "pt-PT",
            });
        expect(res.status).toBe(201);
        expect(profileOf(res.body)).toEqual({
            jurisdictions: ["PT", "ES", "EU"],
            governing_law: "PT",
            working_language: "pt-PT",
        });
        expect(profileOf(stored(res.body.id))).toEqual(profileOf(res.body));
    });

    it("drops repeated jurisdictions and keeps the order", async () => {
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({ name: "Repeats", jurisdictions: ["US_NY", "US", "US_NY"] });
        expect(res.status).toBe(201);
        expect(res.body.jurisdictions).toEqual(["US_NY", "US"]);
        expect(stored(res.body.id).jurisdictions).toEqual(["US_NY", "US"]);
    });

    it("creates a matter with nothing recorded when no field is sent, without a second write", async () => {
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({ name: "Plain" });
        expect(res.status).toBe(201);
        expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
        expect(fake.callsTo("projects", "update")).toEqual([]);
        // Outside an organization there are no defaults to look for.
        expect(fake.callsTo("organizations")).toEqual([]);
    });

    it.each([
        ["an unknown code", { jurisdictions: ["US", "XX"] }, "invalid_jurisdiction", "XX is not a supported jurisdiction."],
        ["a lower-case code", { jurisdictions: ["us"] }, "invalid_jurisdiction", "Jurisdictions must use supported jurisdiction codes."],
        ["a code with trailing spaces", { jurisdictions: ["US "] }, "invalid_jurisdiction", "Jurisdictions must use supported jurisdiction codes."],
        ["a string in place of the list", { jurisdictions: "US" }, "invalid_jurisdiction", "Jurisdictions must be a list of jurisdiction codes."],
        ["more than 10 codes", { jurisdictions: ALL_CODES.slice(0, 11) }, "too_many_jurisdictions", "Choose at most 10 jurisdictions."],
        ["a governing law outside the registry", { governing_law: "XX" }, "invalid_jurisdiction", "XX is not a supported jurisdiction."],
        ["a governing law that is not a code", { governing_law: "England and Wales" }, "invalid_jurisdiction", "Governing law must use supported jurisdiction codes."],
        ["a working language outside the list", { working_language: "xx" }, "invalid_working_language", "Working language must be one of the supported languages."],
        ["the automatic language setting", { working_language: "auto" }, "invalid_working_language", "Working language must be one of the supported languages."],
    ])("refuses %s with a 400 and a stable code, creating nothing", async (_label, fields, code, detail) => {
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({ name: "Refused", ...fields });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ code, detail });
        expect(fake.rpcCalls).toEqual([]);
        expect(fake.tables.projects).toHaveLength(3);
    });

    it("keeps the plain 400 body for the checks that were there before", async () => {
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({ name: "  ", jurisdictions: ["XX"] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ detail: "name is required" });
    });

    describe("in an organization with defaults", () => {
        it("starts a matter with the organization's defaults when no field is sent", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({ name: "New Alpha matter", org_id: ORG_A });
            expect(res.status).toBe(201);
            expect(profileOf(res.body)).toEqual({
                jurisdictions: ["GB", "EU"],
                governing_law: null,
                working_language: "en-GB",
            });
            expect(profileOf(stored(res.body.id))).toEqual(profileOf(res.body));
        });

        it("keeps a matter's own values when they are sent", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({
                    name: "Own values",
                    org_id: ORG_A,
                    jurisdictions: ["DE"],
                    governing_law: "DE",
                    working_language: "de",
                });
            expect(res.status).toBe(201);
            const own = {
                jurisdictions: ["DE"],
                governing_law: "DE",
                working_language: "de",
            };
            expect(profileOf(res.body)).toEqual(own);
            expect(profileOf(stored(res.body.id))).toEqual(own);
            // Nothing was left to inherit, so the defaults were not read.
            expect(
                fake
                    .callsTo("organizations")
                    .filter((call) => call.columns?.includes("default_")),
            ).toEqual([]);
        });

        it("keeps a field sent empty as empty", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({
                    name: "Explicitly empty",
                    org_id: ORG_A,
                    jurisdictions: [],
                    working_language: null,
                });
            expect(res.status).toBe(201);
            expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
            expect(profileOf(stored(res.body.id))).toEqual(EMPTY_PROFILE);
        });

        it("takes the default for each field the request leaves out", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({ name: "Mixed", org_id: ORG_A, jurisdictions: ["IE"], governing_law: "IE" });
            expect(res.status).toBe(201);
            expect(profileOf(res.body)).toEqual({
                jurisdictions: ["IE"],
                governing_law: "IE",
                working_language: "en-GB",
            });
        });

        it("opens the matter to the organization and records the profile in one write", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({ name: "Public", org_id: ORG_A, visibility: "organization" });
            expect(res.status).toBe(201);
            expect(fake.callsTo("projects", "update").map((call) => call.payload)).toEqual([
                {
                    visibility: "organization",
                    jurisdictions: ["GB", "EU"],
                    governing_law: null,
                    working_language: "en-GB",
                },
            ]);
            expect(stored(res.body.id).visibility).toBe("organization");
        });

        it("never copies a default that has since left the registry or the language list", async () => {
            const alpha = fake.tables.organizations.find((o) => o.id === ORG_A) as Row;
            alpha.default_jurisdictions = ["GB", "XX", "not a code"];
            alpha.default_working_language = "auto";
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({ name: "Stale defaults", org_id: ORG_A });
            expect(res.status).toBe(201);
            expect(profileOf(res.body)).toEqual({
                jurisdictions: ["GB"],
                governing_law: null,
                working_language: null,
            });
        });

        it("still creates the matter, with nothing recorded, when the defaults cannot be read", async () => {
            fake.failWhen((call) =>
                call.table === "organizations" && call.columns?.includes("default_")
                    ? { code: "42703", message: "column organizations.default_jurisdictions does not exist" }
                    : null,
            );
            const res = await request(app)
                .post("/projects")
                .set(...as(MIA))
                .send({ name: "Unreadable defaults", org_id: ORG_A });
            expect(res.status).toBe(201);
            expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
            expect(fake.callsTo("projects", "update")).toEqual([]);
        });

        it("does not hand another organization's defaults to someone outside it", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(BOB))
                .send({ name: "Not mine", org_id: ORG_A });
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                detail: "You are not a member of that organization.",
            });
            expect(JSON.stringify(res.body)).not.toContain("GB");
            expect(
                fake
                    .callsTo("organizations")
                    .filter((call) => call.columns?.includes("default_")),
            ).toEqual([]);
            expect(fake.rpcCalls).toEqual([]);
        });

        it("gives a personal matter no organization's defaults", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...as(ALICE))
                .send({ name: "Alice's own" });
            expect(res.status).toBe(201);
            expect(res.body.org_id).toBeNull();
            expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
        });
    });

    it("reports a failed profile write instead of answering as if it were stored", async () => {
        fake.failWhen((call) =>
            call.table === "projects" && call.op === "update"
                ? { code: "23514", message: 'violates check constraint "projects_jurisdictions_limit"' }
                : null,
        );
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({ name: "Write fails", jurisdictions: ["US"] });
        expect(res.status).toBe(500);
        expect(res.body.code).toBe("internal_error");
        expect(JSON.stringify(res.body)).not.toContain("projects_jurisdictions_limit");
    });
});

describe("reading a project's jurisdiction profile", () => {
    it("returns the stored fields on the project detail", async () => {
        const res = await request(app).get("/projects/p-alpha").set(...as(ALICE));
        expect(res.status).toBe(200);
        expect(profileOf(res.body)).toEqual({
            jurisdictions: ["PT", "EU"],
            governing_law: "PT",
            working_language: "pt-PT",
        });
    });

    it("returns them to anyone who can open the matter, whatever their role", async () => {
        // Mia is an editor here: the matter is open to her organization.
        const res = await request(app).get("/projects/p-alpha").set(...as(MIA));
        expect(res.status).toBe(200);
        expect(res.body.access_role).toBe("editor");
        expect(res.body.jurisdictions).toEqual(["PT", "EU"]);
    });

    it("reads a matter with nothing recorded as empty", async () => {
        const res = await request(app).get("/projects/p-carol").set(...as(CAROL));
        expect(res.status).toBe(200);
        expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
    });

    it("reads a row from a database without the columns as empty", async () => {
        const row = stored("p-carol");
        delete row.jurisdictions;
        delete row.governing_law;
        delete row.working_language;
        const res = await request(app).get("/projects/p-carol").set(...as(CAROL));
        expect(res.status).toBe(200);
        expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
    });

    it("adds the profile to every row of the project list", async () => {
        const res = await request(app).get("/projects").set(...as(ALICE));
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toMatchObject({
            id: "p-alpha",
            jurisdictions: ["PT", "EU"],
            governing_law: "PT",
            working_language: "pt-PT",
        });
        // One read for the whole page, never one per project.
        expect(
            fake
                .callsTo("projects", "select")
                .filter((call) => call.columns?.includes("jurisdictions")),
        ).toHaveLength(1);
    });

    it("adds an empty profile to list rows with nothing recorded", async () => {
        const res = await request(app).get("/projects?limit=20").set(...as(CAROL));
        expect(res.status).toBe(200);
        expect(res.body.map((row: Row) => [row.id, profileOf(row)])).toEqual([
            ["p-carol", EMPTY_PROFILE],
        ]);
    });

    it("fails the list rather than show empty profiles when they cannot be read", async () => {
        fake.failWhen((call) =>
            call.table === "projects" && call.columns?.includes("jurisdictions")
                ? { code: "57014", message: "canceling statement due to statement timeout on projects" }
                : null,
        );
        const res = await request(app).get("/projects").set(...as(ALICE));
        expect(res.status).toBe(500);
        expect(res.body.code).toBe("internal_error");
        expect(JSON.stringify(res.body)).not.toContain("statement timeout");
    });

    it("adds the profile to the rows of the summary list", async () => {
        const res = await request(app).get("/projects?view=summary").set(...as(ALICE));
        expect(res.status).toBe(200);
        expect(res.body).toEqual([
            {
                id: "p-alpha",
                name: "Alpha matter",
                org_id: ORG_A,
                memory_enabled: true,
                jurisdictions: ["PT", "EU"],
                governing_law: "PT",
                working_language: "pt-PT",
            },
        ]);
        // One read for the whole page here too.
        expect(
            fake
                .callsTo("projects", "select")
                .filter((call) => call.columns?.includes("jurisdictions")),
        ).toHaveLength(1);
    });

    it("adds an empty profile to summary rows with nothing recorded", async () => {
        const res = await request(app).get("/projects?view=summary").set(...as(CAROL));
        expect(res.status).toBe(200);
        expect(res.body.map((row: Row) => [row.id, profileOf(row)])).toEqual([
            ["p-carol", EMPTY_PROFILE],
        ]);
    });

    it("fails the summary list too when the profiles cannot be read", async () => {
        fake.failWhen((call) =>
            call.table === "projects" && call.columns?.includes("jurisdictions")
                ? { code: "57014", message: "canceling statement due to statement timeout on projects" }
                : null,
        );
        const res = await request(app).get("/projects?view=summary").set(...as(ALICE));
        expect(res.status).toBe(500);
        expect(res.body.code).toBe("internal_error");
        expect(JSON.stringify(res.body)).not.toContain("statement timeout");
    });

    it("returns the profile from the directory search as well", async () => {
        const res = await request(app)
            .get("/projects?view=directory-search&search=Alpha")
            .set(...as(ALICE));
        expect(res.status).toBe(200);
        expect(res.body.map((row: Row) => [row.id, profileOf(row)])).toEqual([
            [
                "p-alpha",
                {
                    jurisdictions: ["PT", "EU"],
                    governing_law: "PT",
                    working_language: "pt-PT",
                },
            ],
        ]);
    });
});

describe("PATCH /projects/:projectId with a jurisdiction profile", () => {
    it("stores and returns the fields sent, leaving the others as they were", async () => {
        const res = await request(app)
            .patch("/projects/p-alpha")
            .set(...as(ALICE))
            .send({ governing_law: "ES" });
        expect(res.status).toBe(200);
        const expected = {
            jurisdictions: ["PT", "EU"],
            governing_law: "ES",
            working_language: "pt-PT",
        };
        expect(profileOf(res.body)).toEqual(expected);
        expect(profileOf(stored("p-alpha"))).toEqual(expected);
        expect(stored("p-alpha").updated_at).not.toBe(T0);
    });

    it("stores all three and returns them on the next read", async () => {
        const next = {
            jurisdictions: ["US", "US_CA", "US_NY"],
            governing_law: "US_NY",
            working_language: "en-US",
        };
        await request(app).patch("/projects/p-carol").set(...as(CAROL)).send(next).expect(200);
        const read = await request(app).get("/projects/p-carol").set(...as(CAROL));
        expect(profileOf(read.body)).toEqual(next);
    });

    it("clears a field sent as null", async () => {
        const res = await request(app)
            .patch("/projects/p-alpha")
            .set(...as(ALICE))
            .send({ jurisdictions: null, governing_law: null, working_language: null });
        expect(res.status).toBe(200);
        expect(profileOf(res.body)).toEqual(EMPTY_PROFILE);
        expect(profileOf(stored("p-alpha"))).toEqual(EMPTY_PROFILE);
    });

    it.each([
        ["an unknown code", { jurisdictions: ["PT", "XX"] }, "invalid_jurisdiction"],
        ["more than 10 codes", { jurisdictions: ALL_CODES.slice(0, 11) }, "too_many_jurisdictions"],
        ["a governing law outside the registry", { governing_law: "XX" }, "invalid_jurisdiction"],
        ["a working language outside the list", { working_language: "tlh" }, "invalid_working_language"],
    ])("refuses %s with a 400 and a stable code, changing nothing", async (_label, fields, code) => {
        const before = structuredClone(stored("p-alpha"));
        const res = await request(app)
            .patch("/projects/p-alpha")
            .set(...as(ALICE))
            // A valid rename rides along; a refused request applies none of it.
            .send({ name: "Renamed", ...fields });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(code);
        expect(typeof res.body.detail).toBe("string");
        expect(stored("p-alpha")).toEqual(before);
        expect(fake.callsTo("projects", "update")).toEqual([]);
        expect(audits()).toEqual([]);
    });

    describe("audit", () => {
        it("writes one row naming who changed which fields on which matter", async () => {
            await request(app)
                .patch("/projects/p-alpha")
                .set(...as(ALICE))
                .send({ jurisdictions: ["PT", "EU", "ES"], working_language: "pt-PT" })
                .expect(200);
            expect(audits()).toHaveLength(1);
            expect(audits()[0]).toMatchObject({
                user_id: ALICE,
                user_email: "alice@example.test",
                org_id: ORG_A,
                action: "project.jurisdiction_profile.updated",
                status: "completed",
                surface: "project",
                project_id: "p-alpha",
                // Only the field that changed: the language was sent as it was.
                detail: {
                    changed: ["jurisdictions"],
                    jurisdictions: ["PT", "EU", "ES"],
                },
            });
        });

        it("records a personal matter's change without an organization", async () => {
            await request(app)
                .patch("/projects/p-carol")
                .set(...as(CAROL))
                .send({ governing_law: "GB", working_language: "en-GB" })
                .expect(200);
            expect(audits()).toHaveLength(1);
            expect(audits()[0]).toMatchObject({
                user_id: CAROL,
                org_id: null,
                project_id: "p-carol",
                detail: {
                    changed: ["governing_law", "working_language"],
                    governing_law: "GB",
                    working_language: "en-GB",
                },
            });
        });

        it("writes nothing when the request repeats what is stored", async () => {
            await request(app)
                .patch("/projects/p-alpha")
                .set(...as(ALICE))
                .send({ jurisdictions: ["PT", "EU"], governing_law: "PT", working_language: "pt-PT" })
                .expect(200);
            expect(audits()).toEqual([]);
        });

        it("writes nothing for an edit that does not touch the profile, and does not read it", async () => {
            await request(app)
                .patch("/projects/p-alpha")
                .set(...as(ALICE))
                .send({ name: "Renamed", practice: "Litigation" })
                .expect(200);
            expect(audits()).toEqual([]);
            expect(
                fake
                    .callsTo("projects", "select")
                    .filter((call) => call.columns === "jurisdictions, governing_law, working_language"),
            ).toEqual([]);
            expect(stored("p-alpha").name).toBe("Renamed");
            // The profile is untouched by an unrelated edit.
            expect(stored("p-alpha").jurisdictions).toEqual(["PT", "EU"]);
        });

        it("records every field sent when the profile could not be read first", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            fake.failWhen((call) =>
                call.table === "projects" &&
                call.op === "select" &&
                call.columns === "jurisdictions, governing_law, working_language"
                    ? { code: "57014", message: "timeout" }
                    : null,
            );
            await request(app)
                .patch("/projects/p-alpha")
                .set(...as(ALICE))
                .send({ governing_law: "PT" })
                .expect(200);
            expect(audits()[0]).toMatchObject({
                detail: { changed: ["governing_law"], governing_law: "PT" },
            });
            warn.mockRestore();
        });
    });

    describe("who may change it", () => {
        it("lets an organization owner change a public matter another member created", async () => {
            fake.tables.projects.push(
                project({
                    id: "p-mia",
                    user_id: MIA,
                    org_id: ORG_A,
                    name: "Mia's matter",
                    visibility: "organization",
                }),
            );
            const res = await request(app)
                .patch("/projects/p-mia")
                .set(...as(ALICE))
                .send({ jurisdictions: ["FR"] });
            expect(res.status).toBe(200);
            expect(stored("p-mia").jurisdictions).toEqual(["FR"]);
        });

        it.each([
            [MIA, "a member, who is an editor of the public matter"],
            [ADAM, "an admin, who is an editor of the public matter"],
        ])("refuses %s (%s) with the project settings refusal", async (user) => {
            const before = structuredClone(stored("p-alpha"));
            const res = await request(app)
                .patch("/projects/p-alpha")
                .set(...as(user))
                .send({ jurisdictions: ["US"], governing_law: "US", working_language: "en-US" });
            expect(res.status).toBe(403);
            expect(res.body).toEqual({
                detail: "Only a project owner can change project settings.",
            });
            expect(stored("p-alpha")).toEqual(before);
            expect(audits()).toEqual([]);
        });
    });
});

describe("tenant isolation of a project's jurisdiction profile", () => {
    it("does not show another organization's project, or its profile", async () => {
        const res = await request(app).get("/projects/p-alpha").set(...as(BOB));
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ detail: "Project not found" });
        expect(JSON.stringify(res.body)).not.toContain("PT");
    });

    it("does not show a personal project to anyone else", async () => {
        await request(app).patch("/projects/p-carol").set(...as(CAROL)).send({ jurisdictions: ["JP"] }).expect(200);
        for (const user of [ALICE, MIA, BOB]) {
            const res = await request(app).get("/projects/p-carol").set(...as(user));
            expect(res.status).toBe(404);
        }
    });

    it("does not let another organization's owner change the profile", async () => {
        const before = structuredClone(stored("p-alpha"));
        const res = await request(app)
            .patch("/projects/p-alpha")
            .set(...as(BOB))
            .send({ jurisdictions: ["BR"], governing_law: "BR", working_language: "pt-BR" });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ detail: "Project not found" });
        expect(stored("p-alpha")).toEqual(before);
        expect(fake.callsTo("projects", "update")).toEqual([]);
        expect(audits()).toEqual([]);
    });

    it("answers someone outside the organization the same way whether the id exists or not", async () => {
        const real = await request(app).patch("/projects/p-alpha").set(...as(CAROL)).send({ governing_law: "GB" });
        const missing = await request(app).patch("/projects/p-nowhere").set(...as(CAROL)).send({ governing_law: "GB" });
        expect(real.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(real.body).toEqual(missing.body);
    });

    it("lists only the caller's own organization's projects and profiles", async () => {
        const alice = await request(app).get("/projects").set(...as(ALICE));
        const bob = await request(app).get("/projects").set(...as(BOB));
        expect(alice.body.map((row: Row) => row.id)).toEqual(["p-alpha"]);
        expect(bob.body.map((row: Row) => row.id)).toEqual(["p-beta"]);
        expect(bob.body[0].jurisdictions).toEqual(["BR"]);
        expect(JSON.stringify(bob.body)).not.toContain("p-alpha");
        // The profile read is scoped to the ids the list function returned.
        const reads = fake
            .callsTo("projects", "select")
            .filter((call) => call.columns?.includes("jurisdictions"));
        expect(reads.map((call) => call.filters)).toEqual([
            [["in", "id", ["p-alpha"]]],
            [["in", "id", ["p-beta"]]],
        ]);
    });

    it("requires a session for the project routes that carry the profile", async () => {
        await request(app).get("/projects/p-alpha").expect(401);
        await request(app).patch("/projects/p-alpha").send({ jurisdictions: ["US"] }).expect(401);
        await request(app).post("/projects").send({ name: "x", jurisdictions: ["US"] }).expect(401);
        expect(fake.calls).toEqual([]);
    });
});

describe("GET /orgs/:orgId/matter-defaults", () => {
    it.each([ALICE, ADAM, MIA])("returns the defaults to %s, a member", async (user) => {
        const res = await request(app).get(`/orgs/${ORG_A}/matter-defaults`).set(...as(user));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            default_jurisdictions: ["GB", "EU"],
            default_working_language: "en-GB",
        });
    });

    it("reads an organization row without the columns as no defaults", async () => {
        const alpha = fake.tables.organizations.find((o) => o.id === ORG_A) as Row;
        delete alpha.default_jurisdictions;
        delete alpha.default_working_language;
        const res = await request(app).get(`/orgs/${ORG_A}/matter-defaults`).set(...as(MIA));
        expect(res.body).toEqual({ default_jurisdictions: [], default_working_language: null });
    });

    it("requires a session", async () => {
        await request(app).get(`/orgs/${ORG_A}/matter-defaults`).expect(401);
    });

    it.each([BOB, CAROL])("answers %s, who is not a member, as for an organization that is not there", async (user) => {
        const res = await request(app).get(`/orgs/${ORG_A}/matter-defaults`).set(...as(user));
        const missing = await request(app).get("/orgs/org-nowhere/matter-defaults").set(...as(user));
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ detail: "Organization not found" });
        expect(res.body).toEqual(missing.body);
        expect(JSON.stringify(res.body)).not.toContain("GB");
    });

    it("answers for a person's own organization as for one that is not there", async () => {
        const res = await request(app).get(`/orgs/${ORG_PERSONAL}/matter-defaults`).set(...as(CAROL));
        expect(res.status).toBe(404);
    });

    it("does not leak the database's message when the read fails", async () => {
        fake.failWhen((call) =>
            call.table === "organizations" && call.columns?.includes("default_")
                ? { code: "57014", message: "statement timeout on organizations" }
                : null,
        );
        const res = await request(app).get(`/orgs/${ORG_A}/matter-defaults`).set(...as(MIA));
        expect(res.status).toBe(500);
        expect(res.body.code).toBe("internal_error");
        expect(JSON.stringify(res.body)).not.toContain("statement timeout");
    });
});

describe("PUT /orgs/:orgId/matter-defaults", () => {
    const org = (id: string) => fake.tables.organizations.find((o) => o.id === id) as Row;
    const defaultsOf = (row: Row) => ({
        default_jurisdictions: row.default_jurisdictions,
        default_working_language: row.default_working_language,
    });

    it.each([
        [ALICE, "an owner"],
        [ADAM, "an admin"],
    ])("lets %s (%s) set both defaults", async (user) => {
        const next = { default_jurisdictions: ["US", "US_NY"], default_working_language: "en-US" };
        const res = await request(app).put(`/orgs/${ORG_A}/matter-defaults`).set(...as(user)).send(next);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(next);
        expect(defaultsOf(org(ORG_A))).toEqual(next);
        // And they read back.
        const read = await request(app).get(`/orgs/${ORG_A}/matter-defaults`).set(...as(MIA));
        expect(read.body).toEqual(next);
    });

    it("changes only the field sent, and clears one sent as null", async () => {
        const one = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ADAM))
            .send({ default_working_language: "fr" });
        expect(one.body).toEqual({ default_jurisdictions: ["GB", "EU"], default_working_language: "fr" });
        const cleared = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ADAM))
            .send({ default_jurisdictions: null, default_working_language: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body).toEqual({ default_jurisdictions: [], default_working_language: null });
        expect(defaultsOf(org(ORG_A))).toEqual(cleared.body);
    });

    it("refuses a member who is not an admin with the organization's forbidden response", async () => {
        const before = structuredClone(org(ORG_A));
        const res = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(MIA))
            .send({ default_jurisdictions: ["US"], default_working_language: "en-US" });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ detail: "Only an organization admin can do that." });
        expect(org(ORG_A)).toEqual(before);
        expect(fake.callsTo("organizations", "update")).toEqual([]);
        expect(audits()).toEqual([]);
    });

    it("refuses a member before looking at what they sent", async () => {
        const res = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(MIA))
            .send({ default_jurisdictions: ["XX"] });
        expect(res.status).toBe(403);
        expect(res.body).not.toHaveProperty("code");
    });

    it.each([BOB, CAROL])("does not let %s, from outside, change or learn of the organization", async (user) => {
        const before = structuredClone(org(ORG_A));
        const res = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(user))
            .send({ default_jurisdictions: ["BR"], default_working_language: "pt-BR" });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ detail: "Organization not found" });
        expect(org(ORG_A)).toEqual(before);
        expect(audits()).toEqual([]);
        // Not even with a body that would be refused for a member.
        const invalid = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(user))
            .send({ default_jurisdictions: ["XX"] });
        expect(invalid.status).toBe(404);
    });

    it("leaves the other organization's defaults alone", async () => {
        const beta = structuredClone(org(ORG_B));
        await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ALICE))
            .send({ default_jurisdictions: ["US"] })
            .expect(200);
        expect(org(ORG_B)).toEqual(beta);
        expect(
            fake.callsTo("organizations", "update").map((call) => call.filters),
        ).toEqual([[["eq", "id", ORG_A]]]);
    });

    it("requires a session", async () => {
        await request(app).put(`/orgs/${ORG_A}/matter-defaults`).send({ default_jurisdictions: [] }).expect(401);
    });

    it("answers for a person's own organization as for one that is not there", async () => {
        const res = await request(app)
            .put(`/orgs/${ORG_PERSONAL}/matter-defaults`)
            .set(...as(CAROL))
            .send({ default_jurisdictions: ["US"] });
        expect(res.status).toBe(404);
        expect(org(ORG_PERSONAL).default_jurisdictions).toEqual([]);
    });

    it.each([
        ["an unknown code", { default_jurisdictions: ["GB", "XX"] }, "invalid_jurisdiction", "XX is not a supported jurisdiction."],
        ["a string in place of the list", { default_jurisdictions: "GB" }, "invalid_jurisdiction", "Default jurisdictions must be a list of jurisdiction codes."],
        ["more than 10 codes", { default_jurisdictions: ALL_CODES.slice(0, 11) }, "too_many_jurisdictions", "Choose at most 10 jurisdictions."],
        ["a language outside the list", { default_working_language: "xx" }, "invalid_working_language", "Default working language must be one of the supported languages."],
    ])("refuses %s with a 400 and a stable code, changing nothing", async (_label, body, code, detail) => {
        const before = structuredClone(org(ORG_A));
        const res = await request(app).put(`/orgs/${ORG_A}/matter-defaults`).set(...as(ADAM)).send(body);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ code, detail });
        expect(org(ORG_A)).toEqual(before);
        expect(audits()).toEqual([]);
    });

    it("audits a change, naming the fields and their new values", async () => {
        await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ADAM))
            .send({ default_jurisdictions: ["GB", "EU"], default_working_language: "en-US" })
            .expect(200);
        expect(audits()).toHaveLength(1);
        expect(audits()[0]).toMatchObject({
            user_id: ADAM,
            user_email: "adam@example.test",
            org_id: ORG_A,
            action: "org.matter_defaults.updated",
            surface: "organization",
            // The jurisdictions were sent as they were.
            detail: { changed: ["default_working_language"], default_working_language: "en-US" },
        });
    });

    it("writes nothing, and no audit row, when nothing changes", async () => {
        const res = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ADAM))
            .send({ default_jurisdictions: ["GB", "EU"], default_working_language: "en-GB" });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ default_jurisdictions: ["GB", "EU"], default_working_language: "en-GB" });
        expect(fake.callsTo("organizations", "update")).toEqual([]);
        expect(audits()).toEqual([]);
        const empty = await request(app).put(`/orgs/${ORG_A}/matter-defaults`).set(...as(ADAM)).send({});
        expect(empty.status).toBe(200);
        expect(fake.callsTo("organizations", "update")).toEqual([]);
    });

    it("leaves existing matters as they were", async () => {
        const before = structuredClone(stored("p-alpha"));
        await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ALICE))
            .send({ default_jurisdictions: ["JP"], default_working_language: "ja" })
            .expect(200);
        expect(stored("p-alpha")).toEqual(before);
        // The next matter starts with the new defaults.
        const res = await request(app).post("/projects").set(...as(MIA)).send({ name: "After", org_id: ORG_A });
        expect(profileOf(res.body)).toEqual({ jurisdictions: ["JP"], governing_law: null, working_language: "ja" });
    });
});

describe("the organization itself", () => {
    it("carries its defaults for new matters", async () => {
        const res = await request(app).get(`/orgs/${ORG_A}`).set(...as(MIA));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            id: ORG_A,
            default_jurisdictions: ["GB", "EU"],
            default_working_language: "en-GB",
        });
    });
});

// A deployment that has not switched the profile on gets the answers it got
// before the profile existed. Values already stored stay stored, for the day
// it is switched on.
describe("while the profile is switched off", () => {
    const PROFILE_KEYS = ["jurisdictions", "governing_law", "working_language"];
    const DEFAULT_KEYS = ["default_jurisdictions", "default_working_language"];
    // Any read of the profile or of an organization's defaults.
    const profileReads = () =>
        fake.calls.filter(
            (call) =>
                (call.table === "projects" &&
                    call.columns?.includes("jurisdictions")) ||
                (call.table === "organizations" &&
                    call.columns?.includes("default_")),
        );
    const expectNoProfile = (row: Row) => {
        for (const key of PROFILE_KEYS) expect(row).not.toHaveProperty(key);
    };

    beforeEach(() => {
        vi.stubEnv("MATTER_JURISDICTIONS_ENABLED", "false");
    });

    it("serves no registry: the path is a project id again, as before", async () => {
        const res = await request(app)
            .get("/projects/jurisdictions")
            .set(...as(CAROL));
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ detail: "Project not found" });
        // And it asks for a session first, like every project route.
        await request(app).get("/projects/jurisdictions").expect(401);
    });

    it("ignores the three fields on create, refusing none, and records nothing", async () => {
        const res = await request(app)
            .post("/projects")
            .set(...as(CAROL))
            .send({
                name: "Plain",
                jurisdictions: ["XX"],
                governing_law: "PT",
                working_language: "auto",
            });
        expect(res.status).toBe(201);
        expectNoProfile(res.body);
        expect(profileOf(stored(res.body.id))).toEqual(EMPTY_PROFILE);
        expect(fake.callsTo("projects", "update")).toEqual([]);
    });

    it("gives a new matter in an organization none of its defaults, without reading them", async () => {
        const res = await request(app)
            .post("/projects")
            .set(...as(MIA))
            .send({ name: "New Alpha matter", org_id: ORG_A });
        expect(res.status).toBe(201);
        expectNoProfile(res.body);
        expect(profileOf(stored(res.body.id))).toEqual(EMPTY_PROFILE);
        expect(profileReads()).toEqual([]);
    });

    it("ignores the three fields on update: the rest applies, the profile stays, nothing is audited", async () => {
        const before = profileOf(stored("p-alpha"));
        const res = await request(app)
            .patch("/projects/p-alpha")
            .set(...as(ALICE))
            .send({
                name: "Renamed",
                jurisdictions: ["XX"],
                governing_law: null,
                working_language: "de",
            });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe("Renamed");
        expectNoProfile(res.body);
        expect(stored("p-alpha").name).toBe("Renamed");
        expect(profileOf(stored("p-alpha"))).toEqual(before);
        expect(audits()).toEqual([]);
        expect(profileReads()).toEqual([]);
    });

    it("leaves the profile out of every project read, without reading it, though it is stored", async () => {
        const detail = await request(app).get("/projects/p-alpha").set(...as(ALICE));
        const list = await request(app).get("/projects").set(...as(ALICE));
        const summary = await request(app)
            .get("/projects?view=summary")
            .set(...as(ALICE));
        const search = await request(app)
            .get("/projects?view=directory-search&search=Alpha")
            .set(...as(ALICE));
        for (const res of [detail, list, summary, search])
            expect(res.status).toBe(200);
        expect(detail.body.name).toBe("Alpha matter");
        expect(list.body.map((row: Row) => row.id)).toEqual(["p-alpha"]);
        expect(search.body.map((row: Row) => row.id)).toEqual(["p-alpha"]);
        for (const row of [detail.body, ...list.body, ...search.body])
            expectNoProfile(row);
        // The summary rows are exactly what they were before the profile.
        expect(summary.body).toEqual([
            { id: "p-alpha", name: "Alpha matter", org_id: ORG_A, memory_enabled: true },
        ]);
        expect(profileReads()).toEqual([]);
        expect(profileOf(stored("p-alpha"))).toEqual({
            jurisdictions: ["PT", "EU"],
            governing_law: "PT",
            working_language: "pt-PT",
        });
    });

    it("has no organization defaults routes: past the organization guard the paths are not found, and nothing changes", async () => {
        const read = await request(app)
            .get(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ALICE));
        const write = await request(app)
            .put(`/orgs/${ORG_A}/matter-defaults`)
            .set(...as(ALICE))
            .send({ default_jurisdictions: ["JP"] });
        for (const res of [read, write]) {
            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain("default_");
            expect(JSON.stringify(res.body)).not.toContain("GB");
        }
        // Every organization route asks for a session first; so do these.
        await request(app).get(`/orgs/${ORG_A}/matter-defaults`).expect(401);
        expect(profileReads()).toEqual([]);
        expect(fake.callsTo("organizations", "update")).toEqual([]);
        expect(
            fake.tables.organizations.find((o) => o.id === ORG_A)
                ?.default_jurisdictions,
        ).toEqual(["GB", "EU"]);
        expect(audits()).toEqual([]);
    });

    it("leaves an organization's defaults out of the organization and its list", async () => {
        const one = await request(app).get(`/orgs/${ORG_A}`).set(...as(MIA));
        const mine = await request(app).get("/orgs").set(...as(MIA));
        expect(one.status).toBe(200);
        expect(one.body).toMatchObject({ id: ORG_A, name: "Alpha LLP" });
        expect(mine.status).toBe(200);
        expect(mine.body.map((org: Row) => org.id)).toEqual([ORG_A]);
        for (const org of [one.body, ...mine.body])
            for (const key of DEFAULT_KEYS) expect(org).not.toHaveProperty(key);
    });
});
