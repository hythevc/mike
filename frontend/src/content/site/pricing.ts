// SPDX-License-Identifier: AGPL-3.0-only
//
// Copy for the public pricing page. No price appears here: plans and their
// prices come from the deployment's plan catalog through GET /plans, and
// this page shows whatever that returns. While billing is off there is no
// checkout, only the account links. No plan is marked as recommended and no
// saving or equivalent price is worked out here: the page says what the
// catalog says.

import { CONTACT_PATH, SITE_CHROME_COPY } from "./chrome";

/** Counts inside the page's English sentences ("Up to 1,000 seats"). */
const COUNT = new Intl.NumberFormat("en-US");

/** A sentence with one link in it, kept in three parts so the link is real. */
export interface LinkedSentence {
    readonly before: string;
    readonly link: string;
    readonly href: string;
    readonly after: string;
}

export const PRICING_COPY = {
    title: "Pricing",
    intro: "Plans are published here as the deployment configures them. Prices are shown as the operator states them; nothing is charged through this page.",
    /** Announced to assistive technology while the plans are fetched. */
    loading: "Loading pricing…",
    unavailable: "Pricing is not available yet.",
    unavailableDetail:
        "This deployment has not published any plans. You can still create an account and bring your own model provider key.",
    unavailableContact: {
        before: "To ask about plans, ",
        link: "contact the operator",
        href: CONTACT_PATH,
        after: ".",
    } as LinkedSentence,
    loadFailed: "Pricing could not be loaded.",
    retry: "Retry",
    seatLimit: (seats: number) =>
        seats === 1 ? "1 seat" : `Up to ${COUNT.format(seats)} seats`,
    noSeatLimit: "No seat limit",
    trial: (days: number) =>
        days === 1 ? "1-day trial" : `${COUNT.format(days)}-day trial`,
    /**
     * What follows a price the catalog states as an amount: what one payment
     * covers, in the catalog's own terms. `unit` is the interval's name
     * ("month", "year").
     */
    pricePer: (unit: string) => `per ${unit}`,
    pricePerSeat: "per seat",
    pricePerSeatPer: (unit: string) => `per seat, per ${unit}`,
    featuresHeading: "Included",
    accountAction: SITE_CHROME_COPY.createAccount,
    signInAction: SITE_CHROME_COPY.signIn,
    billingOff: {
        before: "Billing is not enabled on this deployment, so plans cannot be bought here. Create an account to start, or ",
        link: "contact the operator",
        href: CONTACT_PATH,
        after: " about a plan.",
    } as LinkedSentence,
    /**
     * Above the facts shown directly under the page's action, and the link
     * after them. The facts themselves are in securityFacts.ts.
     */
    trustHeading: "Security facts",
    trustLink: "Read the security page",
    disclaimer: SITE_CHROME_COPY.disclaimer,
} as const;
