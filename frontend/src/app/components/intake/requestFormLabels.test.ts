// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
    HUMAN_REPLY_NOTICE,
    formStatusLabel,
    requestFormUrl,
    retentionNotice,
    senderDomainsLabel,
} from "./requestFormLabels";
import { auditAction, auditActor } from "@/app/components/history/auditPresentation";
import type { AuditEvent } from "@/app/lib/mikeApi";

describe("request form copy", () => {
    it("says how long a submission is kept, in days", () => {
        expect(retentionNotice(365)).toBe(
            "Requests that are not taken on as a matter are deleted after 365 days.",
        );
        expect(retentionNotice(1)).toMatch(/after 1 day\.$/);
        expect(retentionNotice(0)).toMatch(/after 1 day\.$/);
    });

    it("tells requesters that no AI advice is shown and a person replies", () => {
        expect(HUMAN_REPLY_NOTICE).toMatch(/No AI-generated advice/);
        expect(HUMAN_REPLY_NOTICE).toMatch(/a person will reply/);
    });

    it("names a form's status and senders as words", () => {
        expect(formStatusLabel({ enabled: true })).toBe("Accepting requests");
        expect(formStatusLabel({ enabled: false })).toBe("Switched off");
        expect(senderDomainsLabel([])).toBe("Any email address");
        expect(senderDomainsLabel(["acme.example", "partners.example"])).toBe(
            "acme.example, partners.example",
        );
    });

    it("builds the form's link on this web app", () => {
        expect(requestFormUrl("/request/abc", "https://app.example.test")).toBe(
            "https://app.example.test/request/abc",
        );
        expect(requestFormUrl("/request/abc")).toBe(`${window.location.origin}/request/abc`);
    });
});

describe("request form audit rows", () => {
    const event = (action: string): AuditEvent =>
        ({
            id: "e1",
            action,
            status: "completed",
            created_at: "2026-11-08T10:00:00.000Z",
            user_id: null,
            user_email: null,
            user_display_name: null,
            org_id: "org-1",
            detail: { form_id: "f1", request_id: "r1" },
        }) as unknown as AuditEvent;

    it("label the form actions and name the anonymous requester as the actor", () => {
        expect(auditAction(event("request.form_created"))).toBe("Request form created");
        expect(auditAction(event("request.form_link_rotated"))).toBe("Request form link replaced");
        expect(auditAction(event("request.form_submitted"))).toBe("Request submitted through form");
        expect(auditActor(event("request.form_submitted"))).toBe("Requester (form)");
        expect(auditActor(event("request.form_created"))).toBe("Unknown user");
    });
});
