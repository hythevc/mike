// SPDX-License-Identifier: AGPL-3.0-only
//
// Copy for the frame around every public page (the header's links, the site
// navigation and the footer) and for the security page's title and search
// description. It lives with the rest of the site copy so counsel reviews
// every visitor-facing word in one place and W20's content lint scans it. The
// home, pricing and documentation copy reuse the shared strings below, so one
// edit here changes every occurrence.

export const SITE_CHROME_COPY = {
    /** The way into the app: in the header, and under the home and pricing copy. */
    signIn: "Sign in",
    createAccount: "Create an account",
    /** The accessible name of the site navigation landmark. */
    navLabel: "Site",
    /** The public pages the site header links to, in order. */
    nav: [
        { href: "/pricing", label: "Pricing" },
        { href: "/docs", label: "Docs" },
        { href: "/security", label: "Security" },
    ],
    /** The accessible name of the footer's navigation landmark. */
    footerNavLabel: "Legal and source",
    footer: {
        source: "Source",
        terms: "Terms",
        privacy: "Privacy",
        security: "Security",
        attributions: "Attributions",
    },
    /** The line under every public page: these pages describe a tool, not advice. */
    disclaimer: "Legal information, not legal advice.",
} as const;

/** The public security page: its title, and its description for search engines. */
export const SECURITY_PAGE_COPY = {
    title: "Security",
    description:
        "What the software does to protect accounts, keys and documents, stated as facts: encryption of stored keys, multi-factor authentication, single sign-on, the audit log, export and deletion, model providers, and independent certification.",
} as const;
