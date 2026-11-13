// SPDX-License-Identifier: AGPL-3.0-only
//
// Copy for the public contact page. The page has one action: an email to
// the support mailbox named in the brand configuration. It promises no
// response time, no call and no demonstration, because the software cannot
// keep such a promise for the people who run a deployment; an operator who
// can keep one states it in `responseNote`.

import { brand } from "@/shared/brand.generated";

/** A page worth reading before writing, with what it answers. */
export interface ContactPointer {
    readonly href: string;
    readonly label: string;
    readonly note: string;
}

export const CONTACT_COPY = {
    title: "Contact",
    /** Also the page's description for search engines. */
    lede: "Send your question by email. A person reads it and replies by email.",
    /** The page's one action: it opens the visitor's mail program. */
    action: "Send an email",
    /** The subject that email starts with, so it reaches the right queue. */
    subject: `Question about ${brand.productName}`,
    /** Before the address in plain text, for a browser that opens no mail program. */
    addressLead: "Or write to",
    /**
     * When replies can be expected, in the operator's own words, for example
     * the working days the mailbox is read. Null by default: the page then
     * says nothing about timing rather than inventing a promise.
     */
    responseNote: null as string | null,
    includeHeading: "What to include",
    include: [
        "What you want to do, and what happened if something went wrong.",
        "The name of your firm or organization, if you have one.",
        "The email address of your account, if it is not the one you write from.",
        "The page you were on, if your question is about the product.",
    ],
    leaveOut:
        "Leave out client documents and confidential details. This mailbox is for questions, not for matter files.",
    pointersHeading: "Before you write",
    pointers: [
        {
            href: "/security",
            label: "Security",
            note: "what the software does to protect accounts, keys and documents, and where to report a vulnerability.",
        },
        {
            href: "/pricing",
            label: "Pricing",
            note: "the plans this deployment publishes.",
        },
    ] as readonly ContactPointer[],
    /** The way back: to the home page where the site has one, or into the app. */
    backToHome: "Back to the home page",
    backToApp: "Go to the app",
} as const;

/**
 * The `mailto:` address of the page's action: the brand's support mailbox
 * with the subject filled in. Spaces are percent-encoded, because mail
 * programs show a "+" literally.
 */
export function contactMailto(): string {
    return `mailto:${brand.supportEmail}?subject=${encodeURIComponent(CONTACT_COPY.subject)}`;
}
