// SPDX-License-Identifier: AGPL-3.0-only
//
// The request form service below the HTTP layer: tokens and their digests,
// the input parsers, the sender allowlist, and the retention sweep over the
// stateful fake. The HTTP behaviour (one identical 404, the honeypot, the
// rate-limit lanes) is in src/__tests__/integration/intakeForms.routes.test.ts.

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { AppError } from "../../../lib/appError";
import {
    DEFAULT_FORM_DISCLAIMER,
    createRequestForm,
    defaultPrivacyNotice,
    generateFormToken,
    hashFormToken,
    isPlausibleFormToken,
    parsePrivacyPolicyUrl,
    parseRetentionDays,
    parseSenderDomains,
    parseSubmission,
    senderDomainAllowed,
    submitPublicRequestForm,
} from "../intake.forms";
import { deleteExpiredFormSubmissions } from "../intake.retention";
import { FIRM, PEOPLE, auditRows, desk, deskClient, seedFirm, table } from "./deskDbFake";

const db = () => deskClient() as unknown as Db;
const as = (person: { id: string; email: string }) => ({
    userId: person.id,
    userEmail: person.email,
});

beforeEach(() => seedFirm());

describe("form tokens", () => {
    it("are 256 random bits, URL-safe, and stored only as a SHA-256 digest", () => {
        const token = generateFormToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(generateFormToken()).not.toBe(token);
        expect(hashFormToken(token)).toBe(
            createHash("sha256").update(token).digest("hex"),
        );
        expect(isPlausibleFormToken(token)).toBe(true);
        expect(isPlausibleFormToken("short")).toBe(false);
        expect(isPlausibleFormToken(`${token}/../x`)).toBe(false);
        expect(isPlausibleFormToken(undefined)).toBe(false);
    });
});

describe("form settings input", () => {
    it("reads sender domains from a list or one text, lower-cased and without a leading @", () => {
        expect(parseSenderDomains(undefined)).toEqual({ ok: true, value: [] });
        expect(parseSenderDomains("@Acme.example, legal.acme.example\n acme.example")).toEqual({
            ok: true,
            value: ["acme.example", "legal.acme.example"],
        });
        expect(parseSenderDomains(["Partners.Example"])).toEqual({
            ok: true,
            value: ["partners.example"],
        });
        expect(parseSenderDomains("not a domain").ok).toBe(false);
        expect(parseSenderDomains("localhost").ok).toBe(false);
        expect(parseSenderDomains([42]).ok).toBe(false);
        expect(
            parseSenderDomains(Array.from({ length: 51 }, (_, i) => `d${i}.example`)).ok,
        ).toBe(false);
    });

    it("accepts only a web address for the privacy policy", () => {
        expect(parsePrivacyPolicyUrl("")).toEqual({ ok: true, value: null });
        expect(parsePrivacyPolicyUrl(" https://firm.example/privacy ")).toEqual({
            ok: true,
            value: "https://firm.example/privacy",
        });
        expect(parsePrivacyPolicyUrl("javascript:alert(1)").ok).toBe(false);
        expect(parsePrivacyPolicyUrl("firm.example/privacy").ok).toBe(false);
        expect(parsePrivacyPolicyUrl(`https://${"x".repeat(500)}.example`).ok).toBe(false);
    });

    it("keeps retention to whole days between 1 and 3650", () => {
        expect(parseRetentionDays(undefined)).toEqual({ ok: true, value: null });
        expect(parseRetentionDays("90")).toEqual({ ok: true, value: 90 });
        expect(parseRetentionDays(3650)).toEqual({ ok: true, value: 3650 });
        for (const bad of [0, 3651, 1.5, "soon", -1]) expect(parseRetentionDays(bad).ok).toBe(false);
    });
});

describe("a requester's submission", () => {
    const valid = {
        title: " NDA review ",
        details: "Please look at clause 4.",
        requester_name: "Dana Client",
        requester_email: "Dana@Acme.example",
    };

    it("is trimmed, with the email lower-cased", () => {
        expect(parseSubmission(valid)).toEqual({
            ok: true,
            value: {
                title: "NDA review",
                details: "Please look at clause 4.",
                requester_name: "Dana Client",
                requester_email: "dana@acme.example",
            },
        });
    });

    it("names the field to fix in plain words", () => {
        const failing = (body: Record<string, unknown>) => {
            const parsed = parseSubmission(body);
            return parsed.ok ? null : parsed.detail;
        };
        expect(failing({ ...valid, title: "" })).toMatch(/short title/);
        expect(failing({ ...valid, details: 7 })).toMatch(/Describe what you need/);
        expect(failing({ ...valid, requester_name: "" })).toMatch(/your name/);
        expect(failing({ ...valid, requester_email: "dana" })).toMatch(/valid email/);
        expect(failing({ ...valid, requester_email: `${"a".repeat(321)}@x.example` })).toMatch(
            /320 characters/,
        );
    });

    it("matches the sender's domain or a subdomain of an approved one", () => {
        expect(senderDomainAllowed("dana@acme.example", [])).toBe(true);
        expect(senderDomainAllowed("dana@acme.example", ["acme.example"])).toBe(true);
        expect(senderDomainAllowed("dana@legal.acme.example", ["acme.example"])).toBe(true);
        expect(senderDomainAllowed("dana@notacme.example", ["acme.example"])).toBe(false);
        expect(senderDomainAllowed("dana@acme.example.evil", ["acme.example"])).toBe(false);
    });
});

describe("creating a form", () => {
    it("fills in the default notices, naming the organization in the privacy notice", async () => {
        const created = await createRequestForm(db(), {
            ...as(PEOPLE.admin),
            body: { org_id: FIRM },
        });
        if (!created.ok) throw new Error(JSON.stringify(created));
        expect(created.data.form.disclaimer).toBe(DEFAULT_FORM_DISCLAIMER);
        expect(created.data.form.privacy_notice).toBe(defaultPrivacyNotice("Firm"));
        expect(created.data.path).toBe(`/request/${created.data.token}`);
    });

    it("is refused to a member", async () => {
        const refused = await createRequestForm(db(), {
            ...as(PEOPLE.member),
            body: { org_id: FIRM },
        });
        expect(refused).toMatchObject({ ok: false, kind: "forbidden", code: "request_form_admin_only" });
        expect(table("request_desk_forms")).toHaveLength(0);
    });
});

describe("a submission that races a disable", () => {
    it("is answered as not found when the function refuses the form", async () => {
        const created = await createRequestForm(db(), {
            ...as(PEOPLE.admin),
            body: { org_id: FIRM },
        });
        if (!created.ok) throw new Error(JSON.stringify(created));
        // Disabled after the lookup, before the insert.
        desk.beforeRpc = (fn) => {
            if (fn === "request_desk_submit_form_request")
                table("request_desk_forms")[0].enabled = false;
        };
        const result = await submitPublicRequestForm(db(), {
            token: created.data.token,
            body: {
                title: "NDA",
                details: "Please review.",
                requester_name: "Dana",
                requester_email: "dana@acme.example",
            },
        });
        expect(result).toMatchObject({ ok: false, kind: "not_found", code: "request_form_not_found" });
        expect(table("request_desk_requests")).toHaveLength(0);
        expect(auditRows().filter((row) => row.action === "request.form_submitted")).toHaveLength(0);
    });
});

describe("retention of form submissions", () => {
    const DAY = 86_400_000;

    async function submitThrough(token: string, title: string): Promise<string> {
        const result = await submitPublicRequestForm(db(), {
            token,
            body: {
                title,
                details: "Details.",
                requester_name: "Dana",
                requester_email: "dana@acme.example",
            },
        });
        if (!result.ok) throw new Error(JSON.stringify(result));
        return table("request_desk_requests").find((row) => row.title === title)!.id as string;
    }

    it("deletes expired unconverted submissions, with their trail, and keeps converted and recent ones", async () => {
        const shortLived = await createRequestForm(db(), {
            ...as(PEOPLE.admin),
            body: { org_id: FIRM, retention_days: 30 },
        });
        const longLived = await createRequestForm(db(), {
            ...as(PEOPLE.admin),
            body: { org_id: FIRM, retention_days: 365 },
        });
        if (!shortLived.ok || !longLived.ok) throw new Error("create failed");

        const expired = await submitThrough(shortLived.data.token, "Expired");
        const converted = await submitThrough(shortLived.data.token, "Converted");
        const recent = await submitThrough(shortLived.data.token, "Recent");
        const stillKept = await submitThrough(longLived.data.token, "Kept by a longer period");
        const now = Date.now();
        const age = (id: string, days: number) => {
            const row = table("request_desk_requests").find((r) => r.id === id)!;
            row.created_at = new Date(now - days * DAY).toISOString();
        };
        age(expired, 31);
        age(converted, 31);
        age(recent, 29);
        age(stillKept, 31);
        table("request_desk_requests").find((r) => r.id === converted)!.project_id = "a-matter";
        table("request_desk_comments").push({
            id: "c1",
            request_id: expired,
            org_id: FIRM,
            kind: "comment",
            body: "Following up.",
            created_at: new Date(now - 30 * DAY).toISOString(),
        });
        // A member's own request is never touched, however old.
        const internal = await (async () => {
            const { createRequest } = await import("../intake.requests");
            const result = await createRequest(db(), {
                ...as(PEOPLE.member),
                body: { org_id: FIRM, title: "Internal" },
            });
            if (!result.ok) throw new Error("internal create failed");
            return result.data.id;
        })();
        age(internal, 400);

        await expect(deleteExpiredFormSubmissions(db())).resolves.toBe(1);
        const remaining = table("request_desk_requests").map((row) => row.title).sort();
        expect(remaining).toEqual(["Converted", "Internal", "Kept by a longer period", "Recent"]);
        expect(table("request_desk_comments").filter((c) => c.request_id === expired)).toEqual([]);
        expect(desk.rpcCalls.filter((call) => call.fn === "request_desk_delete_expired_form_submissions")).toEqual([
            { fn: "request_desk_delete_expired_form_submissions", args: { p_limit: 500 } },
        ]);
    });

    it("keeps calling while a batch is full, and stops at its batch cap", async () => {
        const full = { rpc: vi.fn(async () => ({ data: 500, error: null })) } as unknown as Db;
        await expect(deleteExpiredFormSubmissions(full)).resolves.toBe(10_000);
        expect((full.rpc as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(20);
    });

    it("fails with a typed error that carries no row data", async () => {
        const failing = {
            rpc: vi.fn(async () => ({
                data: null,
                error: { code: "42501", message: "dana@acme.example" },
            })),
        } as unknown as Db;
        const failure = await deleteExpiredFormSubmissions(failing).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(AppError);
        expect((failure as AppError).kind).toBe("request_desk.retention_failed");
        expect((failure as Error).message).not.toContain("dana");
    });
});
