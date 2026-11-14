// SPDX-License-Identifier: AGPL-3.0-only
//
// Formats a plan's price for the pricing page.
//
// Today the plan catalog states a price as text (`display_price_text`) and
// GET /plans sends only that, so the page shows the text as the operator
// wrote it. This module is the seam for a catalog that states the price as
// data instead: an amount, an ISO 4217 currency and what one payment covers.
// When a plan carries those fields the page formats them with Intl; when it
// does not, or they are not usable, the caller falls back to the text.
// Nothing is worked out here that the catalog did not state: no monthly
// equivalent of a yearly price, no saving, no total.
//
// The amount is formatted in the visitor's own locale, because how a
// currency is written depends on where the reader is: the same dollar
// amount carries a country prefix for a reader whose own currency is also
// called the dollar. It is only ever formatted in the browser, after the
// plans have been fetched, so the server and the browser cannot disagree.

import type { PublicPlan } from "@mike/contracts";
import { PRICING_COPY } from "@/content/site/pricing";

/** What one payment covers. */
export type PlanPriceInterval = "month" | "year";

/**
 * The structured price a catalog may state beside `display_price_text`. All
 * optional: the API does not send them yet (see the note above).
 */
export interface PlanPriceFields {
    /** The amount as a decimal number in the currency's main unit. */
    readonly price_amount?: number | null;
    /** The ISO 4217 code of the currency the amount is in. */
    readonly price_currency?: string | null;
    /** What one payment covers; omitted for a price with no interval. */
    readonly price_interval?: PlanPriceInterval | null;
    /** Whether the amount is charged for each seat. */
    readonly price_per_seat?: boolean | null;
}

/** A public plan, with the structured price it may carry. */
export type PricedPlan = PublicPlan & PlanPriceFields;

export interface FormattedPlanPrice {
    /** The amount in its currency, formatted for the locale. */
    readonly amount: string;
    /** What the amount is for ("per seat, per month"), or null for a bare price. */
    readonly qualifier: string | null;
}

const INTERVALS: readonly PlanPriceInterval[] = ["month", "year"];
const CURRENCY_CODE = /^[A-Za-z]{3}$/;

/**
 * The name of an interval in the page's language, taken from Intl's unit
 * data ("month", "year") so it is never spelled by hand.
 */
export function intervalUnitLabel(interval: PlanPriceInterval, language = "en"): string {
    try {
        const unit = new Intl.NumberFormat(language, {
            style: "unit",
            unit: interval,
            unitDisplay: "long",
        })
            .formatToParts(1)
            .find((part) => part.type === "unit");
        if (unit?.value) return unit.value;
    } catch {
        // An engine without unit formatting: the interval's own name is the
        // same word in English, which is the language the page is written in.
    }
    return interval;
}

/**
 * The plan's structured price, formatted with `Intl.NumberFormat` in the
 * catalog's currency, or null when the plan states no usable one (the
 * caller then shows `display_price_text`). `locale` is the visitor's by
 * default. Every amount keeps the currency's own number of decimals, so two
 * plans side by side are written the same way.
 */
export function formatPlanPrice(
    plan: PricedPlan,
    locale?: Intl.LocalesArgument,
): FormattedPlanPrice | null {
    const amount = plan.price_amount;
    const currency = plan.price_currency;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
    if (typeof currency !== "string" || !CURRENCY_CODE.test(currency)) return null;

    let formatted: string;
    try {
        formatted = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: currency.toUpperCase(),
        }).format(amount);
    } catch {
        // Intl refused the currency or the locale: show the operator's text.
        return null;
    }

    const interval =
        plan.price_interval && INTERVALS.includes(plan.price_interval)
            ? intervalUnitLabel(plan.price_interval)
            : null;
    const perSeat = plan.price_per_seat === true;
    let qualifier: string | null = null;
    if (perSeat && interval) qualifier = PRICING_COPY.pricePerSeatPer(interval);
    else if (perSeat) qualifier = PRICING_COPY.pricePerSeat;
    else if (interval) qualifier = PRICING_COPY.pricePer(interval);
    return { amount: formatted, qualifier };
}
