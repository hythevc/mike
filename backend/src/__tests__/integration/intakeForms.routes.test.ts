// SPDX-License-Identifier: AGPL-3.0-only
//
// The public request form over HTTP: who may manage forms, what a link
// token looks like on the wire and in the database, the one identical 404
// for unknown, disabled and rotated links, the honeypot, the field caps and
// sender allowlist, the reference-only answer with no model call, the
// ids-only audit rows, and the dedicated rate-limit lanes that answer before
// any lookup and count across app instances sharing one store.
//
// The database is the stateful fake in modules/intake/__tests__/deskDbFake.ts;
// the shared rate-limit store is the in-memory stand-in from helpers/rateLimitRpc.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRateLimitDb } from "../helpers/rateLimitRpc";
import {
    FIRM,
    PEOPLE,
    PERSONAL_ORG,
    auditRows,
    deskClient,
    seedFirm,
    table,
} from "../../modules/intake/__tests__/deskDbFake";

const RATE_LIMIT_FUNCTIONS = new Set([
    "check_rate_limit",
    "decrement_rate_limit",
    "reset_rate_limit",
    "prune_rate_limit_windows",
]);

const holder = vi.hoisted(() => {
    // Read when the lanes are built, at import: before app.ts loads. The
    // public form lanes count in the shared store, with small budgets so the
    // tests reach them in a few requests.
    process.env.RATE_LIMIT_STORE = "postgres";
    process.env.RATE_LIMIT_REQUEST_FORM_MAX = "4";
    process.env.RATE_LIMIT_REQUEST_FORM_SUBMIT_MAX = "3";
    process.env.FRONTEND_URL = "https://app.example.test";
    return {
        rateLimit: null as null | ReturnType<typeof fakeRateLimitDb>,
        /** Every table the request desk read or wrote, in order. */
        reads: [] as string[],
        makeDesk: null as null | (() => ReturnType<typeof deskClient>),
    };
});

const providers = vi.hoisted(() => ({
    stream: vi.fn(),
    complete: vi.fn(),
}));

// One client serves both the request desk tables (the desk fake) and the
// rate-limit functions (the rate-limit fake). It is built per call, from the
// test module's own fake instances, so a second app instance imported after
// vi.resetModules() still shares them.
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => {
        const desk = holder.makeDesk!();
        return {
            from: (name: string) => {
                holder.reads.push(name);
                return desk.from(name);
            },
            rpc: (fn: string, args: Record<string, unknown> = {}) =>
                RATE_LIMIT_FUNCTIONS.has(fn)
                    ? holder.rateLimit!.db.rpc(fn, args)
                    : desk.rpc(fn, args),
        };
    }),
}));

let currentUser: { id: string; email: string } = PEOPLE.admin;

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = currentUser.id;
        res.locals.userEmail = currentUser.email;
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// The provider spy: nothing in a public submission may call a model.
vi.mock("../../lib/llm/providers", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm/providers")>()),
    streamWithProvider: providers.stream,
    completeWithProvider: providers.complete,
}));

import { app } from "../../app";

holder.makeDesk = deskClient;

/** The client's table of codes it acts on. */
const codeKinds = (() => {
    const source = readFileSync(
        resolve(__dirname, "../../../../frontend/src/shared/lib/userError.ts"),
        "utf8",
    );
    const start = source.indexOf("export const CODE_KINDS");
    return source.slice(start, source.indexOf("};", start));
})();

function expectListedCode(body: { code?: unknown }, code: string) {
    expect(body.code).toBe(code);
    expect(codeKinds).toMatch(new RegExp(`\\n\\s+${code}: "`));
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const NOT_FOUND_BODY = {
    code: "request_form_not_found",
    detail: "This request form is not available.",
};

const as = (person: { id: string; email: string }) => {
    currentUser = person;
    return request(app);
};

/** A plausible token that names no form. */
const UNKNOWN_TOKEN = "A".repeat(43);

let visitorAddress = 0;
/** A fresh client address per anonymous visitor, so budgets do not carry over. */
function visitor(instance: Express = app, address = `203.0.113.${(visitorAddress += 1)}`) {
    return {
        get: (path: string) => request(instance).get(path).set("X-Forwarded-For", address),
        post: (path: string) => request(instance).post(path).set("X-Forwarded-For", address),
    };
}

const SUBMISSION = {
    title: "NDA for the new supplier",
    details: "Please review the attached draft before Friday.",
    requester_name: "Dana Client",
    requester_email: "dana@acme.example",
};

async function createForm(body: Record<string, unknown> = {}) {
    const response = await as(PEOPLE.admin)
        .post("/intake/forms")
        .send({ org_id: FIRM, ...body });
    expect(response.status).toBe(201);
    return response.body as { form: { id: string }; token: string; path: string };
}

beforeEach(() => {
    seedFirm();
    holder.rateLimit = fakeRateLimitDb();
    holder.reads = [];
    currentUser = PEOPLE.admin;
    providers.stream.mockReset();
    providers.complete.mockReset();
});

describe("managing request forms", () => {
    it("is for owners and admins of an organization only", async () => {
        const member = await as(PEOPLE.member)
            .post("/intake/forms")
            .send({ org_id: FIRM });
        expect(member.status).toBe(403);
        expectListedCode(member.body, "request_form_admin_only");

        const listed = await as(PEOPLE.member).get(`/intake/forms?workspace=${FIRM}`);
        expect(listed.status).toBe(403);
        expectListedCode(listed.body, "request_form_admin_only");

        const personal = await as(PEOPLE.member)
            .post("/intake/forms")
            .send({ org_id: PERSONAL_ORG });
        expect(personal.status).toBe(400);
        expectListedCode(personal.body, "request_desk_org_only");

        const outsider = await as(PEOPLE.outsider).get(`/intake/forms?workspace=${FIRM}`);
        expect(outsider.status).toBe(404);
        expect(table("request_desk_forms")).toHaveLength(0);
    });

    it("creates a form with default notices, returning the token once and storing only its digest", async () => {
        const created = await as(PEOPLE.owner).post("/intake/forms").send({ org_id: FIRM });
        expect(created.status).toBe(201);
        const { form, token, path } = created.body;
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(path).toBe(`/request/${token}`);
        expect(form).toMatchObject({
            org_id: FIRM,
            title: "Legal request",
            intro: "",
            enabled: true,
            retention_days: 365,
            allowed_sender_domains: [],
            privacy_policy_url: null,
            token_rotated_at: null,
            created_by: { user_id: PEOPLE.owner.id, is_member: true },
        });
        expect(form.disclaimer).toMatch(/does not create a lawyer-client relationship/);
        expect(form.privacy_notice).toMatch(/^Firm controls the personal data/);
        expect(form).not.toHaveProperty("token");
        expect(form).not.toHaveProperty("token_hash");

        const rows = table("request_desk_forms");
        expect(rows).toHaveLength(1);
        expect(rows[0].token_hash).toBe(digest(token));
        expect(JSON.stringify(rows)).not.toContain(token);

        const audit = auditRows().filter((row) => row.action === "request.form_created");
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
            user_id: PEOPLE.owner.id,
            org_id: FIRM,
            surface: "intake",
            title: null,
            detail: { form_id: form.id },
        });

        const listed = await as(PEOPLE.admin).get(`/intake/forms?workspace=${FIRM}`);
        expect(listed.status).toBe(200);
        expect(listed.body.forms).toHaveLength(1);
        expect(JSON.stringify(listed.body)).not.toContain(token);
        expect(JSON.stringify(listed.body)).not.toContain(digest(token));
    });

    it("edits notices and settings, refuses an emptied notice, and audits enabling and disabling", async () => {
        const { form } = await createForm();
        const edited = await as(PEOPLE.admin)
            .patch(`/intake/forms/${form.id}`)
            .send({
                title: "Ask the legal team",
                intro: "Tell us what you need and when.",
                allowed_sender_domains: "@Acme.example, partners.example\nacme.example",
                retention_days: 90,
                privacy_policy_url: "https://acme.example/privacy",
            });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({
            title: "Ask the legal team",
            intro: "Tell us what you need and when.",
            allowed_sender_domains: ["acme.example", "partners.example"],
            retention_days: 90,
            privacy_policy_url: "https://acme.example/privacy",
        });

        const emptied = await as(PEOPLE.admin)
            .patch(`/intake/forms/${form.id}`)
            .send({ disclaimer: "   " });
        expect(emptied.status).toBe(400);
        expect(emptied.body.detail).toMatch(/disclaimer is required/);

        const badUrl = await as(PEOPLE.admin)
            .patch(`/intake/forms/${form.id}`)
            .send({ privacy_policy_url: "javascript:alert(1)" });
        expect(badUrl.status).toBe(400);

        const badRetention = await as(PEOPLE.admin)
            .patch(`/intake/forms/${form.id}`)
            .send({ retention_days: 0 });
        expect(badRetention.status).toBe(400);

        const disabled = await as(PEOPLE.admin)
            .patch(`/intake/forms/${form.id}`)
            .send({ enabled: false });
        expect(disabled.status).toBe(200);
        expect(disabled.body.enabled).toBe(false);

        const actions = auditRows().map((row) => row.action);
        expect(actions).toEqual([
            "request.form_created",
            "request.form_updated",
            "request.form_disabled",
        ]);
        for (const row of auditRows()) {
            expect(row.title ?? null).toBeNull();
            expect(Object.keys(row.detail as object)).toEqual(["form_id"]);
        }

        const member = await as(PEOPLE.member)
            .patch(`/intake/forms/${form.id}`)
            .send({ title: "Mine" });
        expect(member.status).toBe(403);
        const outsider = await as(PEOPLE.outsider)
            .patch(`/intake/forms/${form.id}`)
            .send({ title: "Mine" });
        expect(outsider.status).toBe(404);
    });
});

describe("the public form", () => {
    it("answers unknown, malformed, disabled and rotated links with one identical 404", async () => {
        const { form, token } = await createForm();
        const live = await visitor().get(`/request-forms/${token}`);
        expect(live.status).toBe(200);

        const unknown = await visitor().get(`/request-forms/${UNKNOWN_TOKEN}`);
        const malformed = await visitor().get("/request-forms/short");
        const submitUnknown = await visitor()
            .post(`/request-forms/${UNKNOWN_TOKEN}/submit`)
            .send(SUBMISSION);

        const rotated = await as(PEOPLE.admin).post(`/intake/forms/${form.id}/rotate`).send();
        expect(rotated.status).toBe(200);
        expect(rotated.body.token).not.toBe(token);
        expect(rotated.body.form.token_rotated_at).toEqual(expect.any(String));
        expect(table("request_desk_forms")[0].token_hash).toBe(digest(rotated.body.token));
        const oldLink = await visitor().get(`/request-forms/${token}`);
        const newLink = await visitor().get(`/request-forms/${rotated.body.token}`);
        expect(newLink.status).toBe(200);

        const off = await as(PEOPLE.admin)
            .patch(`/intake/forms/${form.id}`)
            .send({ enabled: false });
        expect(off.status).toBe(200);
        const disabled = await visitor().get(`/request-forms/${rotated.body.token}`);
        const submitDisabled = await visitor()
            .post(`/request-forms/${rotated.body.token}/submit`)
            .send(SUBMISSION);

        for (const response of [unknown, malformed, submitUnknown, oldLink, disabled, submitDisabled]) {
            expect(response.status).toBe(404);
            expect(response.body).toEqual(NOT_FOUND_BODY);
        }
        expectListedCode(unknown.body, "request_form_not_found");
        expect(
            auditRows().filter((row) => row.action === "request.form_link_rotated"),
        ).toHaveLength(1);
        expect(table("request_desk_requests")).toHaveLength(0);
    });

    it("shows the organization's name and logo with the notices, and nothing internal", async () => {
        table("org_logos").push({
            org_id: FIRM,
            content_type: "image/png",
            data_base64: "aGVsbG8=",
            updated_at: "2026-11-01T00:00:00.000Z",
        });
        const { form, token } = await createForm({
            intro: "Tell us what you need.",
            allowed_sender_domains: ["acme.example"],
            retention_days: 180,
            privacy_policy_url: "https://firm.example/privacy",
        });
        const response = await visitor().get(`/request-forms/${token}`);
        expect(response.status).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toEqual({
            organization: { name: "Firm", logo_data_url: "data:image/png;base64,aGVsbG8=" },
            title: "Legal request",
            intro: "Tell us what you need.",
            disclaimer: expect.stringMatching(/lawyer-client relationship/),
            privacy_notice: expect.stringMatching(/^Firm controls/),
            privacy_policy_url: "https://firm.example/privacy",
            retention_days: 180,
            restricts_sender_domains: true,
        });
        const text = JSON.stringify(response.body);
        expect(text).not.toContain(FIRM);
        expect(text).not.toContain(form.id);
        expect(text).not.toContain("acme.example");
    });

    it("tells a robot that filled the hidden field it succeeded, and writes nothing", async () => {
        const { token } = await createForm();
        const response = await visitor()
            .post(`/request-forms/${token}/submit`)
            .send({ ...SUBMISSION, website: "https://spam.example" });
        expect(response.status).toBe(201);
        expect(Object.keys(response.body)).toEqual(["reference"]);
        expect(response.body.reference).toMatch(/^REQ-\d+$/);
        expect(table("request_desk_requests")).toHaveLength(0);
        expect(table("request_desk_comments")).toHaveLength(0);
        expect(
            auditRows().filter((row) => row.action === "request.form_submitted"),
        ).toHaveLength(0);
    });

    it("files a valid submission as a 'form' request, answers with the reference alone and calls no model", async () => {
        const { form, token } = await createForm();
        const response = await visitor()
            .post(`/request-forms/${token}/submit`)
            .send({ ...SUBMISSION, requester_email: "Dana@Acme.example", website: "" });
        expect(response.status).toBe(201);
        expect(response.body).toEqual({ reference: "REQ-1" });

        const rows = table("request_desk_requests");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            org_id: FIRM,
            source: "form",
            created_by: null,
            form_id: form.id,
            status: "new",
            priority: "normal",
            title: SUBMISSION.title,
            details: SUBMISSION.details,
            requester_name: SUBMISSION.requester_name,
            requester_email: "dana@acme.example",
            assignee_user_id: null,
            project_id: null,
        });
        expect(providers.stream).not.toHaveBeenCalled();
        expect(providers.complete).not.toHaveBeenCalled();

        const audit = auditRows().filter((row) => row.action === "request.form_submitted");
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
            user_id: null,
            org_id: FIRM,
            surface: "intake",
            title: null,
            detail: { form_id: form.id, request_id: rows[0].id },
        });
        const serialized = JSON.stringify(audit[0]);
        for (const text of [SUBMISSION.title, SUBMISSION.details, "Dana", "acme.example"])
            expect(serialized).not.toContain(text);

        // The legal team sees it on the board like any other request.
        const board = await as(PEOPLE.member).get(`/intake/requests?workspace=${FIRM}`);
        expect(board.status).toBe(200);
        expect(board.body.requests[0]).toMatchObject({
            reference: "REQ-1",
            source: "form",
            created_by: null,
            requester_email: "dana@acme.example",
        });
    });

    it("caps every field and tells the requester what to fix", async () => {
        const { token } = await createForm();
        const cases: [Record<string, unknown>, RegExp][] = [
            [{ ...SUBMISSION, title: "   " }, /short title/],
            [{ ...SUBMISSION, title: "x".repeat(201) }, /200 characters/],
            [{ ...SUBMISSION, details: "" }, /Describe what you need/],
            [{ ...SUBMISSION, details: "x".repeat(10_001) }, /10,000 characters/],
            [{ ...SUBMISSION, requester_name: undefined }, /Add your name/],
            [{ ...SUBMISSION, requester_email: undefined }, /email address the legal team/],
            [{ ...SUBMISSION, requester_email: "not-an-email" }, /valid email address/],
        ];
        for (const [body, detail] of cases) {
            const response = await visitor().post(`/request-forms/${token}/submit`).send(body);
            expect(response.status, JSON.stringify(body)).toBe(400);
            expect(response.body.detail).toMatch(detail);
        }
        expect(table("request_desk_requests")).toHaveLength(0);
    });

    it("refuses a sender outside the approved domains without naming them, and allows a subdomain", async () => {
        const { token } = await createForm({ allowed_sender_domains: ["acme.example"] });
        const refused = await visitor()
            .post(`/request-forms/${token}/submit`)
            .send({ ...SUBMISSION, requester_email: "dana@other.example" });
        expect(refused.status).toBe(400);
        expectListedCode(refused.body, "request_form_sender_not_allowed");
        expect(refused.body.detail).not.toContain("acme.example");

        const lookalike = await visitor()
            .post(`/request-forms/${token}/submit`)
            .send({ ...SUBMISSION, requester_email: "dana@notacme.example" });
        expect(lookalike.status).toBe(400);

        const allowed = await visitor()
            .post(`/request-forms/${token}/submit`)
            .send({ ...SUBMISSION, requester_email: "dana@legal.acme.example" });
        expect(allowed.status).toBe(201);
        expect(table("request_desk_requests")).toHaveLength(1);
    });
});

describe("the public form's rate limits", () => {
    // Importing the whole app can be slow on a busy machine.
    const IMPORT_TIMEOUT_MS = 60_000;

    it("answers 429 before any lookup, counting across two app instances that share the store", async () => {
        const { token } = await createForm();
        vi.resetModules();
        const second = (await import("../../app.js")).app;
        const address = "198.51.100.42";

        holder.reads = [];
        const first = visitor(app, address);
        const other = visitor(second, address);
        expect((await first.get(`/request-forms/${token}`)).status).toBe(200);
        expect((await other.get(`/request-forms/${token}`)).status).toBe(200);
        expect((await first.get(`/request-forms/${token}`)).status).toBe(200);
        expect((await other.get(`/request-forms/${token}`)).status).toBe(200);

        holder.reads = [];
        const limited = await other.get(`/request-forms/${token}`);
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual({
            code: "rate_limited",
            detail: "Too many requests for this form. Please try again later.",
        });
        // Refused by the lane: no table was read for it.
        expect(holder.reads).toEqual([]);
        expect(
            holder.rateLimit!.counted().filter((call) =>
                String(call.args.p_key).startsWith("public-request-form:"),
            ),
        ).toHaveLength(5);
    }, IMPORT_TIMEOUT_MS);

    it("does not give a forged X-Forwarded-For entry a fresh budget", async () => {
        const { token } = await createForm();
        // The trusted proxy writes the right-most entry; the left ones are
        // whatever the caller sent. Three different forgeries, one budget.
        const forged = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"].map(
            (fake) => `${fake}, 198.51.100.77`,
        );
        const statuses: number[] = [];
        for (const header of forged) {
            const response = await request(app)
                .get(`/request-forms/${token}`)
                .set("X-Forwarded-For", header);
            statuses.push(response.status);
        }
        expect(statuses).toEqual([200, 200, 200, 200, 429]);
        const keys = holder.rateLimit!
            .counted()
            .map((call) => String(call.args.p_key))
            .filter((key) => key.startsWith("public-request-form:"));
        expect(new Set(keys)).toEqual(new Set([`public-request-form:${digest("198.51.100.77")}`]));
    });

    it("holds submissions to their own tighter lane", async () => {
        const { token } = await createForm();
        const address = "198.51.100.99";
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await visitor(app, address)
                .post(`/request-forms/${token}/submit`)
                .send(SUBMISSION);
            statuses.push(response.status);
        }
        expect(statuses).toEqual([201, 201, 201]);
        expect(table("request_desk_requests")).toHaveLength(3);
        expect(holder.reads.length).toBeGreaterThan(0);

        // The fourth submission is still within the form's general budget
        // (4) and is refused by the submission lane (3), before any lookup.
        holder.reads = [];
        const refused = await visitor(app, address)
            .post(`/request-forms/${token}/submit`)
            .send(SUBMISSION);
        expect(refused.status).toBe(429);
        expect(refused.body).toEqual({
            code: "rate_limited",
            detail: "Too many submissions. Please try again later.",
        });
        expect(holder.reads).toEqual([]);
        expect(table("request_desk_requests")).toHaveLength(3);
    });
});
