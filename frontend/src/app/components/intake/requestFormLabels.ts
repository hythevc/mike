// SPDX-License-Identifier: AGPL-3.0-only
//
// Plain-text copy for the public request form and the page that manages
// forms. The notices an organization edits (disclaimer, privacy notice) come
// from the form itself; the lines here are the product's own and say the same
// thing to every requester. Every word a requester reads on the public page
// is either the organization's or in this file, so counsel reviews it in one
// place and the content lint scans it.
//
// Nothing here promises when or how a reply comes. The product cannot keep
// such a promise for the legal team that owns the form; what happens next is
// said in the organization's own wording.

import type { RequestDeskForm } from "@/app/lib/mikeApi";

/** Counts inside the form's English sentences ("10,000 characters"). */
const COUNT = new Intl.NumberFormat("en-US");

/** Shown on every public form, in the product's words, not the organization's. */
export const HUMAN_REPLY_NOTICE =
    "No AI-generated advice is shown here. Your request goes to the legal team, and a person will reply to you.";

/** How long a submission is kept, from the form's retention period. */
export function retentionNotice(retentionDays: number): string {
    const days = Math.max(1, Math.trunc(retentionDays));
    return `Requests that are not taken on as a matter are deleted after ${COUNT.format(days)} ${days === 1 ? "day" : "days"}.`;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/** The fields a requester fills in. */
export type RequestFieldName = "title" | "details" | "name" | "email";

/** The fields in the order the form shows them and the summary lists them. */
export const REQUEST_FIELD_ORDER: readonly RequestFieldName[] = [
    "title",
    "details",
    "name",
    "email",
];

/** Said once above the fields, instead of marking each one. */
export const ALL_FIELDS_REQUIRED = "All fields are required.";

/**
 * Each field's visible label and, where it helps, a hint shown under the
 * label. A hint is text on the page, not a placeholder, so it is still there
 * once the requester starts typing.
 */
export const REQUEST_FIELD_COPY = {
    title: {
        label: "What is the request about?",
        hint: "A few words, for example: supplier contract review.",
    },
    details: {
        label: "Details",
        hint: "What you need, by when, and any background the legal team should know.",
    },
    name: { label: "Your name", hint: null },
    email: { label: "Your email address", hint: null },
} as const satisfies Record<RequestFieldName, { label: string; hint: string | null }>;

/** Under the email label of a form that accepts approved domains only. */
export const WORK_EMAIL_HINT =
    "Use your work email address. This form accepts requests from approved domains only.";

/** The longest value each field takes; the server applies the same limits. */
export const REQUEST_FIELD_MAX = {
    title: 200,
    details: 10000,
    name: 200,
    email: 320,
} as const satisfies Record<RequestFieldName, number>;

/**
 * What each field says when it cannot be sent: the server's own sentences,
 * so the page and the API never disagree about what is wrong.
 */
export const REQUEST_FIELD_ERRORS = {
    title: {
        missing: "Add a short title for your request.",
        tooLong: `Keep the title to ${COUNT.format(REQUEST_FIELD_MAX.title)} characters.`,
    },
    details: {
        missing: "Describe what you need.",
        tooLong: `Keep the details to ${COUNT.format(REQUEST_FIELD_MAX.details)} characters.`,
    },
    name: {
        missing: "Add your name.",
        tooLong: `Keep your name to ${COUNT.format(REQUEST_FIELD_MAX.name)} characters.`,
    },
    email: {
        missing: "Add the email address the legal team should reply to.",
        tooLong: `Keep the email address to ${COUNT.format(REQUEST_FIELD_MAX.email)} characters.`,
    },
} as const satisfies Record<RequestFieldName, { missing: string; tooLong: string }>;

export const INVALID_EMAIL_ERROR = "Enter a valid email address.";

/** Added to a "too long" message so the requester knows how much to cut. */
export function currentLengthNote(length: number): string {
    return `It has ${COUNT.format(length)}.`;
}

/** Read out before a field's message; the message itself is what is shown. */
export const FIELD_ERROR_PREFIX = "Error:";

/** The summary that takes focus when a request could not be sent. */
export const REQUEST_NOT_SENT_TITLE = "Your request was not sent";
export function fieldsToCorrectLead(count: number): string {
    return count === 1
        ? "Correct this field, then send the request again:"
        : `Correct these ${COUNT.format(count)} fields, then send the request again:`;
}

export const SEND_REQUEST_LABEL = "Send request";
export const SENDING_REQUEST_LABEL = "Sending…";

// ---------------------------------------------------------------------------
// The notices
// ---------------------------------------------------------------------------

/** Above the notices while the form is still to be sent. */
export const NOTICES_BEFORE_HEADING = "Before you send";
/** Above the same notices once the request is in. */
export const NOTICES_AFTER_HEADING = "What happens next";
/** Introduces the organization's own notice, so it reads as theirs. */
export function organizationNoticeLead(organizationName: string): string {
    return `From ${organizationName}:`;
}
export const PRIVACY_POLICY_LINK_LABEL = "Read the privacy policy";

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------

/** The confirmation after a submission; the reference is shown beside it. */
export const RECEIPT_TITLE = "Your request has been received";
export const RECEIPT_REFERENCE_LEAD = "Your reference is";
export const RECEIPT_KEEP_REFERENCE =
    "Keep this reference. It is how you and the legal team refer to this request.";

// ---------------------------------------------------------------------------
// Loading and unavailable
// ---------------------------------------------------------------------------

export const FORM_LOADING_LABEL = "Loading the request form…";

/** The one notice for a link that is unknown, disabled or has been replaced. */
export const FORM_UNAVAILABLE_TITLE = "This request form is not available";
export const FORM_UNAVAILABLE_MESSAGE =
    "The link may have been replaced or switched off. Ask the legal team for a current link.";

export const FORM_LOAD_FAILED_TITLE = "The request form did not load";
export const FORM_LOAD_FAILED_MESSAGE =
    "Something went wrong on our side. Try again in a moment.";
export const FORM_RETRY_LABEL = "Try again";

// ---------------------------------------------------------------------------
// The page that manages forms
// ---------------------------------------------------------------------------

/** The form's status, as words. */
export function formStatusLabel(form: Pick<RequestDeskForm, "enabled">): string {
    return form.enabled ? "Accepting requests" : "Switched off";
}

/** The domains a form accepts senders from, as one line. */
export function senderDomainsLabel(domains: readonly string[]): string {
    return domains.length === 0 ? "Any email address" : domains.join(", ");
}

/** Where a form's link opens, on this web app. */
export function requestFormUrl(path: string, origin?: string): string {
    const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}${path}`;
}
