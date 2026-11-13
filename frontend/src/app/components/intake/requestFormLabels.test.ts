// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    ALL_FIELDS_REQUIRED,
    FORM_LOAD_FAILED_MESSAGE,
    FORM_UNAVAILABLE_MESSAGE,
    HUMAN_REPLY_NOTICE,
    INVALID_EMAIL_ERROR,
    NOTICES_AFTER_HEADING,
    NOTICES_BEFORE_HEADING,
    RECEIPT_KEEP_REFERENCE,
    RECEIPT_REFERENCE_LEAD,
    RECEIPT_TITLE,
    REQUEST_FIELD_COPY,
    REQUEST_FIELD_ERRORS,
    REQUEST_FIELD_MAX,
    REQUEST_FIELD_ORDER,
    REQUEST_NOT_SENT_TITLE,
    SENDING_REQUEST_LABEL,
    SEND_REQUEST_LABEL,
    WORK_EMAIL_HINT,
    currentLengthNote,
    fieldsToCorrectLead,
    formStatusLabel,
    organizationNoticeLead,
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
        // The longest period a form allows is still written the English way.
        expect(retentionNotice(3650)).toMatch(/after 3,650 days\.$/);
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

describe("the public form's fields", () => {
    it("labels the four fields in the order the form shows them", () => {
        expect([...REQUEST_FIELD_ORDER]).toEqual(["title", "details", "name", "email"]);
        expect(REQUEST_FIELD_ORDER.map((field) => REQUEST_FIELD_COPY[field].label)).toEqual([
            "What is the request about?",
            "Details",
            "Your name",
            "Your email address",
        ]);
        expect(ALL_FIELDS_REQUIRED).toBe("All fields are required.");
    });

    it("gives the two open questions a hint, as text that stays on the page", () => {
        expect(REQUEST_FIELD_COPY.title.hint).toMatch(/for example/);
        expect(REQUEST_FIELD_COPY.details.hint).toMatch(/by when/);
        expect(REQUEST_FIELD_COPY.name.hint).toBeNull();
        expect(REQUEST_FIELD_COPY.email.hint).toBeNull();
        expect(WORK_EMAIL_HINT).toMatch(/work email address/);
    });

    it("says what is wrong with a field, and how long a value may be", () => {
        for (const field of REQUEST_FIELD_ORDER) {
            expect(REQUEST_FIELD_ERRORS[field].missing).toMatch(/^(Add|Describe) .+\.$/);
            expect(REQUEST_FIELD_ERRORS[field].tooLong).toMatch(/^Keep .+ characters\.$/);
        }
        expect(REQUEST_FIELD_ERRORS.details.tooLong).toBe(
            "Keep the details to 10,000 characters.",
        );
        expect(currentLengthNote(250)).toBe("It has 250.");
        expect(currentLengthNote(10001)).toBe("It has 10,001.");
        expect(INVALID_EMAIL_ERROR).toBe("Enter a valid email address.");
    });

    it("uses the server's own sentences and limits, so the page and the API agree", () => {
        // The public form's service states the same sentences and maximum
        // lengths; a change on either side fails here until both agree.
        const service = readFileSync(
            path.resolve(process.cwd(), "..", "backend/src/modules/intake/intake.forms.ts"),
            "utf8",
        );
        const limits: Record<(typeof REQUEST_FIELD_ORDER)[number], string> = {
            title: "SUBMISSION_TITLE_MAX",
            details: "SUBMISSION_DETAILS_MAX",
            name: "SUBMISSION_NAME_MAX",
            email: "SUBMISSION_EMAIL_MAX",
        };
        for (const field of REQUEST_FIELD_ORDER) {
            expect(service, field).toContain(`"${REQUEST_FIELD_ERRORS[field].missing}"`);
            expect(service, field).toContain(
                `const ${limits[field]} = ${REQUEST_FIELD_MAX[field]};`,
            );
            // "Keep the title to ${SUBMISSION_TITLE_MAX} characters." on the
            // server, with the number filled in on the page.
            const lead = REQUEST_FIELD_ERRORS[field].tooLong.replace(/ [\d,]+ characters\.$/, "");
            expect(service, field).toContain(`\`${lead} \${${limits[field]}`);
        }
        expect(service).toContain(`"${INVALID_EMAIL_ERROR}"`);
    });

    it("counts the fields to correct in words that agree with the number", () => {
        expect(REQUEST_NOT_SENT_TITLE).toBe("Your request was not sent");
        expect(fieldsToCorrectLead(1)).toBe("Correct this field, then send the request again:");
        expect(fieldsToCorrectLead(3)).toBe(
            "Correct these 3 fields, then send the request again:",
        );
    });

    it("names the action by what it does, and marks a request on its way", () => {
        expect(SEND_REQUEST_LABEL).toBe("Send request");
        expect(SENDING_REQUEST_LABEL).toBe("Sending…");
    });
});

describe("the notices and the receipt", () => {
    it("heads the notices by where the requester is: before sending, and after", () => {
        expect(NOTICES_BEFORE_HEADING).toBe("Before you send");
        expect(NOTICES_AFTER_HEADING).toBe("What happens next");
        expect(organizationNoticeLead("Harbour Legal")).toBe("From Harbour Legal:");
    });

    it("gives the reference and why to keep it, and promises no time or channel", () => {
        expect(RECEIPT_TITLE).toBe("Your request has been received");
        expect(RECEIPT_REFERENCE_LEAD).toBe("Your reference is");
        expect(RECEIPT_KEEP_REFERENCE).toMatch(/^Keep this reference\./);
        // What happens next is the organization's to say. The product's own
        // lines name no day, hour or way of replying.
        for (const line of [
            RECEIPT_TITLE,
            RECEIPT_KEEP_REFERENCE,
            HUMAN_REPLY_NOTICE,
            NOTICES_AFTER_HEADING,
            FORM_UNAVAILABLE_MESSAGE,
            FORM_LOAD_FAILED_MESSAGE,
        ]) {
            expect(line, line).not.toMatch(/\d/);
            expect(line, line).not.toMatch(
                /\b(?:within|hours?|days?|business|working|shortly|soon|promptly|by email|by phone|call)\b/i,
            );
        }
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
