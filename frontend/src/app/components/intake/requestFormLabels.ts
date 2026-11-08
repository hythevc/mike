// SPDX-License-Identifier: AGPL-3.0-only
//
// Plain-text copy for the public request form and the page that manages
// forms. The notices an organization edits (disclaimer, privacy notice) come
// from the form itself; the lines here are the product's own and say the same
// thing to every requester.

import type { RequestDeskForm } from "@/app/lib/mikeApi";

/** Shown on every public form, in the product's words, not the organization's. */
export const HUMAN_REPLY_NOTICE =
    "No AI-generated advice is shown here. Your request goes to the legal team, and a person will reply to you.";

/** How long a submission is kept, from the form's retention period. */
export function retentionNotice(retentionDays: number): string {
    const days = Math.max(1, Math.trunc(retentionDays));
    return `Requests that are not taken on as a matter are deleted after ${days} ${days === 1 ? "day" : "days"}.`;
}

/** The confirmation after a submission; the reference is shown beside it. */
export const RECEIPT_TITLE = "Your request has been received";
export const RECEIPT_KEEP_REFERENCE =
    "Keep this reference. The legal team will reply to you outside this page, by email or phone, and the reference is how to refer to your request.";

/** The one notice for a link that is unknown, disabled or has been replaced. */
export const FORM_UNAVAILABLE_TITLE = "This request form is not available";
export const FORM_UNAVAILABLE_MESSAGE =
    "The link may have been replaced or switched off. Ask the legal team for a current link.";

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
