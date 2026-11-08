// SPDX-License-Identifier: AGPL-3.0-only
//
// Copy for the public pricing page. No price appears here: plans and their
// display prices come from the deployment's plan catalog through GET /plans,
// and this page shows whatever that returns. While billing is off there is
// no checkout, only the account links.

export const PRICING_COPY = {
    title: "Pricing",
    intro: "Plans are published here as the deployment configures them. Prices are shown as the operator states them; nothing is charged through this page.",
    unavailable: "Pricing is not available yet.",
    unavailableDetail:
        "This deployment has not published any plans. You can still create an account and bring your own model provider key.",
    loadFailed: "Pricing could not be loaded.",
    retry: "Retry",
    seatLimit: (seats: number) =>
        seats === 1 ? "1 seat" : `Up to ${seats} seats`,
    noSeatLimit: "No seat limit",
    trial: (days: number) => (days === 1 ? "1-day trial" : `${days}-day trial`),
    featuresHeading: "Included",
    accountAction: "Create an account",
    signInAction: "Sign in",
    billingOffNote:
        "Billing is not enabled on this deployment, so plans cannot be bought here. Create an account to start, or contact the operator about a plan.",
    disclaimer: "Legal information, not legal advice.",
} as const;
