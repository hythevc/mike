// SPDX-License-Identifier: AGPL-3.0-only
import type { PublicPlan } from "@mike/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPlanPrice, intervalUnitLabel, type PricedPlan } from "./planPrice";

// XTS is the ISO 4217 code reserved for testing: no such currency exists, so
// nothing below can be read as a price of anything. The amounts are
// placeholders chosen to show grouping and decimals.
const TEST_CURRENCY = "XTS";
const PLACEHOLDER_AMOUNT = 1234.5;

const BASE: PublicPlan = {
    key: "example",
    name: "Example plan",
    description: "",
    seat_limit: null,
    features: [],
    deployment_token_allowance: null,
    trial_days: null,
    sort_order: 1,
    display_price_text: "Example price",
};

const priced = (fields: Partial<PricedPlan>): PricedPlan => ({ ...BASE, ...fields });

/** What Intl itself gives for the amount, in a locale. */
const expected = (locale: string | undefined, amount: number, currency = TEST_CURRENCY) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);

afterEach(() => {
    vi.restoreAllMocks();
});

describe("formatPlanPrice", () => {
    it("formats the amount with Intl.NumberFormat in the catalog's currency", () => {
        const spy = vi.spyOn(Intl, "NumberFormat");
        const price = formatPlanPrice(
            priced({ price_amount: PLACEHOLDER_AMOUNT, price_currency: TEST_CURRENCY }),
            "en-US",
        );
        expect(spy).toHaveBeenCalledWith("en-US", { style: "currency", currency: TEST_CURRENCY });
        expect(price).toEqual({
            amount: expected("en-US", PLACEHOLDER_AMOUNT),
            qualifier: null,
        });
        // The currency is on the figure, and it is the catalog's.
        expect(price!.amount).toContain(TEST_CURRENCY);
        expect(price!.amount).toContain("1,234.50");
    });

    it("follows the reader's locale: separators and the place of the currency change", () => {
        const plan = priced({ price_amount: PLACEHOLDER_AMOUNT, price_currency: TEST_CURRENCY });
        const german = formatPlanPrice(plan, "de-DE")!.amount;
        const american = formatPlanPrice(plan, "en-US")!.amount;
        expect(german).toBe(expected("de-DE", PLACEHOLDER_AMOUNT));
        expect(german).toContain("1.234,50");
        expect(german).not.toBe(american);
    });

    it("uses the visitor's own locale when none is given", () => {
        const plan = priced({ price_amount: PLACEHOLDER_AMOUNT, price_currency: TEST_CURRENCY });
        expect(formatPlanPrice(plan)!.amount).toBe(expected(undefined, PLACEHOLDER_AMOUNT));
    });

    it("writes every amount with the currency's own decimals, whole or not", () => {
        const whole = formatPlanPrice(
            priced({ price_amount: 1, price_currency: TEST_CURRENCY }),
            "en-US",
        )!.amount;
        expect(whole).toBe(expected("en-US", 1));
        expect(whole).toContain("1.00");
        // A currency with no minor unit has none to show.
        const yen = formatPlanPrice(priced({ price_amount: 1, price_currency: "JPY" }), "en-US")!
            .amount;
        expect(yen).toBe(expected("en-US", 1, "JPY"));
        expect(yen).not.toContain(".");
    });

    it("accepts the currency code in either case", () => {
        expect(
            formatPlanPrice(priced({ price_amount: 1, price_currency: "xts" }), "en-US")!.amount,
        ).toBe(expected("en-US", 1));
    });

    it("says what one payment covers, with the interval's name taken from Intl", () => {
        const spy = vi.spyOn(Intl, "NumberFormat");
        const base = { price_amount: 1, price_currency: TEST_CURRENCY } as const;
        expect(formatPlanPrice(priced({ ...base, price_interval: "month" }))!.qualifier).toBe(
            "per month",
        );
        expect(spy).toHaveBeenCalledWith("en", {
            style: "unit",
            unit: "month",
            unitDisplay: "long",
        });
        expect(formatPlanPrice(priced({ ...base, price_interval: "year" }))!.qualifier).toBe(
            "per year",
        );
        expect(
            formatPlanPrice(priced({ ...base, price_interval: "month", price_per_seat: true }))!
                .qualifier,
        ).toBe("per seat, per month");
        expect(formatPlanPrice(priced({ ...base, price_per_seat: true }))!.qualifier).toBe(
            "per seat",
        );
        expect(formatPlanPrice(priced({ ...base, price_per_seat: false }))!.qualifier).toBeNull();
    });

    it("works out nothing the catalog did not state", () => {
        // A yearly price stays a yearly price: no monthly equivalent, no
        // saving and no total appear beside it.
        const yearly = formatPlanPrice(
            priced({
                price_amount: PLACEHOLDER_AMOUNT,
                price_currency: TEST_CURRENCY,
                price_interval: "year",
            }),
            "en-US",
        )!;
        expect(yearly.amount).toBe(expected("en-US", PLACEHOLDER_AMOUNT));
        expect(yearly.qualifier).toBe("per year");
        expect(`${yearly.amount} ${yearly.qualifier}`).not.toMatch(/month|sav|equivalent|total/i);
    });

    it("returns null when the catalog states no usable price, so the text is shown", () => {
        const none: Partial<PricedPlan>[] = [
            {},
            { price_amount: PLACEHOLDER_AMOUNT },
            { price_currency: TEST_CURRENCY },
            { price_amount: null, price_currency: TEST_CURRENCY },
            { price_amount: Number.NaN, price_currency: TEST_CURRENCY },
            { price_amount: Number.POSITIVE_INFINITY, price_currency: TEST_CURRENCY },
            { price_amount: -1, price_currency: TEST_CURRENCY },
            { price_amount: "1" as unknown as number, price_currency: TEST_CURRENCY },
            { price_amount: 1, price_currency: "" },
            { price_amount: 1, price_currency: "XT" },
            { price_amount: 1, price_currency: "money" },
            { price_amount: 1, price_currency: 1 as unknown as string },
        ];
        for (const fields of none) {
            expect(formatPlanPrice(priced(fields)), JSON.stringify(fields)).toBeNull();
        }
    });

    it("returns null when Intl refuses the locale, rather than throwing", () => {
        expect(
            formatPlanPrice(
                priced({ price_amount: 1, price_currency: TEST_CURRENCY }),
                "not a locale",
            ),
        ).toBeNull();
    });

    it("ignores an interval it does not know", () => {
        expect(
            formatPlanPrice(
                priced({
                    price_amount: 1,
                    price_currency: TEST_CURRENCY,
                    price_interval: "fortnight" as unknown as "month",
                }),
            )!.qualifier,
        ).toBeNull();
    });
});

describe("intervalUnitLabel", () => {
    it("names the interval in the page's language", () => {
        expect(intervalUnitLabel("month")).toBe("month");
        expect(intervalUnitLabel("year")).toBe("year");
        expect(intervalUnitLabel("month", "de")).toBe("Monat");
    });

    it("falls back to the interval's own name where Intl has no unit formatting", () => {
        // A plain function, because the code under test calls it with `new`.
        vi.spyOn(Intl, "NumberFormat").mockImplementation(function () {
            throw new RangeError("unit formatting is not supported");
        } as never);
        expect(intervalUnitLabel("year")).toBe("year");
    });
});
