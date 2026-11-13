// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlansResponse } from "@mike/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACT_PATH } from "@/content/site/chrome";
import { PRICING_COPY } from "@/content/site/pricing";
import { securityFactLine, securityFacts } from "@/content/site/securityFacts";
import { brand } from "@/shared/brand.generated";

vi.mock("@/app/lib/mikeApi", () => ({
    getPlans: vi.fn(),
}));

import { getPlans } from "@/app/lib/mikeApi";
import { PricingPlans, plansGridClassName } from "./PricingPlans";
import type { PricedPlan } from "./planPrice";

const mockedGetPlans = vi.mocked(getPlans);

// Fixture plans with placeholder price text: prices come only from a
// deployment's catalog, never from source.
const WITH_PLANS: PlansResponse = {
    plans_enabled: true,
    billing_enabled: false,
    plans: [
        {
            key: "team",
            name: "Team plan",
            description: "For a small team.",
            seat_limit: 5,
            features: ["Shared matters", "Audit log"],
            deployment_token_allowance: null,
            trial_days: 14,
            sort_order: 2,
            display_price_text: "Example price B",
        },
        {
            key: "byok",
            name: "Bring your own key",
            description: "Use your own model provider key.",
            seat_limit: null,
            features: ["Your provider key"],
            deployment_token_allowance: null,
            trial_days: null,
            sort_order: 1,
            display_price_text: "Example price A",
        },
    ],
};

const NO_PLANS: PlansResponse = {
    plans_enabled: false,
    billing_enabled: false,
    plans: [],
};

// A catalog that states its prices as data. XTS is the ISO 4217 code reserved
// for testing, so no figure here is a price of anything; the amount is a
// placeholder chosen to show grouping and decimals.
const TEST_CURRENCY = "XTS";
const PLACEHOLDER_AMOUNT = 1234.5;
const STRUCTURED_PLAN: PricedPlan = {
    ...WITH_PLANS.plans[0],
    key: "structured",
    name: "Structured plan",
    sort_order: 1,
    price_amount: PLACEHOLDER_AMOUNT,
    price_currency: TEST_CURRENCY,
    price_interval: "month",
    price_per_seat: true,
};
const WITH_STRUCTURED_PRICE: PlansResponse = {
    plans_enabled: true,
    billing_enabled: false,
    plans: [STRUCTURED_PLAN, { ...WITH_PLANS.plans[1], sort_order: 2 }],
};

const CHECKOUT = /checkout|subscribe|buy|purchase|upgrade/i;

const frame = (container: HTMLElement) =>
    container.querySelector('[data-slot="pricing-plans"]') as HTMLElement;

/** The frame's shape: its tag, its slot, and the slots of its direct children. */
function frameShape(container: HTMLElement) {
    const outer = frame(container);
    return {
        tag: outer.tagName,
        slot: outer.getAttribute("data-slot"),
        className: outer.className,
        children: [...outer.children].map((child) => child.getAttribute("data-slot")),
    };
}

beforeEach(() => {
    mockedGetPlans.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("PricingPlans", () => {
    it("renders the public plans in catalog order, with their price text and no checkout", async () => {
        mockedGetPlans.mockResolvedValue(WITH_PLANS);
        render(<PricingPlans />);

        const headings = await screen.findAllByRole("heading", { level: 2 });
        expect(headings.map((h) => h.textContent)).toEqual([
            "Bring your own key",
            "Team plan",
        ]);
        expect(screen.getByText("Example price A")).toBeInTheDocument();
        expect(screen.getByText("Example price B")).toBeInTheDocument();
        expect(screen.getByText("Shared matters")).toBeInTheDocument();
        expect(screen.getByText(/Up to 5 seats/)).toBeInTheDocument();
        expect(screen.getByText(/14-day trial/)).toBeInTheDocument();
        expect(screen.getByText(PRICING_COPY.noSeatLimit)).toBeInTheDocument();

        // Billing is off: the only actions are an account and sign-in.
        expect(screen.queryByRole("link", { name: CHECKOUT })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: CHECKOUT })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: PRICING_COPY.accountAction })).toHaveAttribute(
            "href",
            "/signup",
        );
        expect(screen.getByRole("link", { name: PRICING_COPY.signInAction })).toHaveAttribute(
            "href",
            "/login",
        );
        expect(mockedGetPlans).toHaveBeenCalledTimes(1);
    });

    it("shows every feature row without a disclosure control", async () => {
        mockedGetPlans.mockResolvedValue(WITH_PLANS);
        const { container } = render(<PricingPlans />);
        await screen.findByText("Team plan");

        // Every feature of every plan is on the page as a list item.
        for (const plan of WITH_PLANS.plans) {
            const card = screen
                .getByRole("heading", { level: 2, name: plan.name })
                .closest("li") as HTMLElement;
            const features = within(
                within(card).getByRole("heading", { level: 3, name: PRICING_COPY.featuresHeading })
                    .nextElementSibling as HTMLElement,
            ).getAllByRole("listitem");
            expect(features.map((item) => item.textContent)).toEqual(plan.features);
            for (const item of features) expect(item).toBeVisible();
        }
        // Nothing to open first: no disclosure element, no expanding button,
        // no tab and nothing hidden.
        expect(container.querySelector("details, summary")).toBeNull();
        expect(container.querySelector("[aria-expanded], [aria-controls], [hidden]")).toBeNull();
        expect(screen.queryByRole("tab")).toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("formats a structured price with Intl.NumberFormat in the catalog's currency", async () => {
        const numberFormat = vi.spyOn(Intl, "NumberFormat");
        mockedGetPlans.mockResolvedValue(WITH_STRUCTURED_PRICE);
        const { container } = render(<PricingPlans />);
        await screen.findByText("Structured plan");

        // The amount, as Intl writes it for this reader, in the plan's currency.
        const amount = new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: TEST_CURRENCY,
        }).format(PLACEHOLDER_AMOUNT);
        const prices = container.querySelectorAll('[data-slot="plan-price"]');
        expect(prices).toHaveLength(2);
        // Compared character for character: Intl puts a no-break space
        // between the currency and the figure, and the page keeps it.
        expect(prices[0].firstElementChild?.textContent).toBe(amount);
        expect(amount).toContain(TEST_CURRENCY);
        // The interval, in the catalog's own terms, named from Intl's unit data.
        expect(prices[0]).toHaveTextContent("per seat, per month");
        expect(numberFormat).toHaveBeenCalledWith(undefined, {
            style: "currency",
            currency: TEST_CURRENCY,
        });
        expect(numberFormat).toHaveBeenCalledWith("en", {
            style: "unit",
            unit: "month",
            unitDisplay: "long",
        });
        // The operator's text is not shown beside a price stated as data...
        expect(screen.queryByText(STRUCTURED_PLAN.display_price_text)).toBeNull();
        // ...and a plan without one still shows its text, exactly as written.
        expect(prices[1]).toHaveTextContent(/^Example price A$/);
    });

    it("works out no equivalent price or saving beside what the catalog states", async () => {
        const yearlyPlan: PricedPlan = {
            ...STRUCTURED_PLAN,
            price_interval: "year",
            price_per_seat: false,
        };
        mockedGetPlans.mockResolvedValue({
            ...WITH_STRUCTURED_PRICE,
            plans: [yearlyPlan],
        } as PlansResponse);
        const { container } = render(<PricingPlans />);
        await screen.findByText("Structured plan");
        const price = container.querySelector('[data-slot="plan-price"]') as HTMLElement;
        expect(price).toHaveTextContent("per year");
        expect(price.textContent).not.toMatch(/month|sav|equivalent|total|off\b/i);
    });

    it("marks no plan as recommended: the cards differ only in what the catalog says", async () => {
        mockedGetPlans.mockResolvedValue(WITH_PLANS);
        const { container } = render(<PricingPlans />);
        await screen.findByText("Team plan");

        expect(
            screen.queryByText(/recommended|most popular|popular|best value|our pick/i),
        ).toBeNull();
        const cards = [...container.querySelectorAll('[data-slot="plan-list"] > li')];
        expect(cards).toHaveLength(2);
        // Same wrapper and same card surface for every plan: none is bigger,
        // tinted, outlined or badged.
        const surfaces = cards.map((card) => (card.firstElementChild as HTMLElement).className);
        expect(new Set(cards.map((card) => card.className)).size).toBe(1);
        expect(new Set(surfaces).size).toBe(1);
        expect(new Set(cards.map((card) => card.querySelector("h2")!.className)).size).toBe(1);
        expect(container.querySelector('[data-slot="plan-list"] svg')).toBeNull();
    });

    it("puts the security facts directly after the primary action, linked to the security page", async () => {
        mockedGetPlans.mockResolvedValue(WITH_PLANS);
        const { container } = render(<PricingPlans />);
        await screen.findByText("Team plan");

        const actions = container.querySelector('[data-slot="pricing-actions"]') as HTMLElement;
        const primary = actions.querySelectorAll('[data-slot="primary-action"]');
        // One filled action on the page, 44px tall.
        expect(container.querySelectorAll('[data-slot="primary-action"]')).toHaveLength(1);
        expect(primary).toHaveLength(1);
        expect(primary[0]).toHaveTextContent(PRICING_COPY.accountAction);
        expect(primary[0].className.split(/\s+/)).toContain("h-11");

        // The strip is the very next thing after the row that holds the action.
        const actionRow = primary[0].parentElement as HTMLElement;
        const next = actionRow.nextElementSibling as HTMLElement;
        const strip = next.querySelector('[data-slot="trust-strip"]') as HTMLElement;
        expect(strip).not.toBeNull();
        expect(next.firstElementChild).toBe(strip);
        expect(
            primary[0].compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        // Every line of it is a fact of the registry.
        const known = securityFacts().map(securityFactLine);
        const lines = within(strip).getAllByRole("listitem");
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) expect(known).toContain(line.textContent);
        expect(within(strip).getByRole("link", { name: PRICING_COPY.trustLink })).toHaveAttribute(
            "href",
            brand.legalDocuments.security.url,
        );
        expect(brand.legalDocuments.security.url).toBe("/security");
    });

    it("links to the contact page where it mentions contacting the operator", async () => {
        mockedGetPlans.mockResolvedValue(WITH_PLANS);
        const { unmount } = render(<PricingPlans />);
        await screen.findByText("Team plan");
        // Billing is off: the sentence says so and the link is real.
        const { billingOff } = PRICING_COPY;
        const link = screen.getByRole("link", { name: billingOff.link });
        expect(link).toHaveAttribute("href", CONTACT_PATH);
        expect(link.parentElement).toHaveTextContent(
            `${billingOff.before}${billingOff.link}${billingOff.after}`,
        );
        unmount();

        mockedGetPlans.mockResolvedValue(NO_PLANS);
        render(<PricingPlans />);
        await screen.findByText(PRICING_COPY.unavailable);
        expect(
            screen.getByRole("link", { name: PRICING_COPY.unavailableContact.link }),
        ).toHaveAttribute("href", CONTACT_PATH);
    });

    it("leaves the billing sentence out once billing is on", async () => {
        mockedGetPlans.mockResolvedValue({ ...WITH_PLANS, billing_enabled: true });
        render(<PricingPlans />);
        await screen.findByText("Team plan");
        expect(screen.queryByText(new RegExp(PRICING_COPY.billingOff.before.trim()))).toBeNull();
        expect(screen.queryByRole("link", { name: PRICING_COPY.billingOff.link })).toBeNull();
        // Still no checkout on this page.
        expect(screen.queryByRole("link", { name: CHECKOUT })).not.toBeInTheDocument();
    });

    it("says pricing is not available yet when the deployment publishes no plans", async () => {
        mockedGetPlans.mockResolvedValue(NO_PLANS);
        render(<PricingPlans />);
        expect(await screen.findByText(PRICING_COPY.unavailable)).toBeInTheDocument();
        expect(
            screen.getByText(new RegExp(`^${PRICING_COPY.unavailableDetail}`)),
        ).toBeInTheDocument();
        expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: CHECKOUT })).not.toBeInTheDocument();
    });

    it("shows a loading state first, with the action and its facts already there", () => {
        mockedGetPlans.mockReturnValue(new Promise(() => {}));
        const { container } = render(<PricingPlans />);
        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("aria-busy", "true");
        expect(status).toHaveTextContent(PRICING_COPY.loading);
        // The action does not wait for the request.
        expect(screen.getByRole("link", { name: PRICING_COPY.accountAction })).toBeInTheDocument();
        expect(container.querySelector('[data-slot="trust-strip"]')).not.toBeNull();
    });

    it("renders the same outer element while loading, with plans, with none and after a failure", async () => {
        mockedGetPlans.mockReturnValue(new Promise(() => {}));
        const loading = render(<PricingPlans />);
        const loadingShape = frameShape(loading.container);
        expect(frame(loading.container)).toHaveAttribute("data-state", "loading");
        loading.unmount();

        mockedGetPlans.mockReset();
        mockedGetPlans.mockResolvedValue(WITH_PLANS);
        const plans = render(<PricingPlans />);
        await screen.findByText("Team plan");
        const plansShape = frameShape(plans.container);
        expect(frame(plans.container)).toHaveAttribute("data-state", "plans");
        plans.unmount();

        mockedGetPlans.mockReset();
        mockedGetPlans.mockResolvedValue(NO_PLANS);
        const none = render(<PricingPlans />);
        await screen.findByText(PRICING_COPY.unavailable);
        const noneShape = frameShape(none.container);
        expect(frame(none.container)).toHaveAttribute("data-state", "unavailable");
        none.unmount();

        mockedGetPlans.mockReset();
        mockedGetPlans.mockRejectedValue(new Error("boom"));
        const failed = render(<PricingPlans />);
        await screen.findByRole("alert");
        const failedShape = frameShape(failed.container);
        expect(frame(failed.container)).toHaveAttribute("data-state", "failed");

        // One frame: the same element, the same classes, the same two parts.
        expect(loadingShape).toEqual({
            tag: "DIV",
            slot: "pricing-plans",
            className: loadingShape.className,
            children: ["pricing-region", "pricing-actions"],
        });
        expect(plansShape).toEqual(loadingShape);
        expect(noneShape).toEqual(loadingShape);
        expect(failedShape).toEqual(loadingShape);
        // And in every state the action and its facts are part of it.
        const actions = failed.container.querySelector('[data-slot="pricing-actions"]')!;
        expect(actions.querySelector('[data-slot="primary-action"]')).not.toBeNull();
        expect(actions.querySelector('[data-slot="trust-strip"]')).not.toBeNull();
    });

    it("shows a failed load with Retry, and loads the plans on retry", async () => {
        mockedGetPlans
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce(WITH_PLANS);
        const { container } = render(<PricingPlans />);

        const alert = await screen.findByRole("alert");
        // What did not happen, said once, then what to do about it.
        expect(within(alert).getAllByText(PRICING_COPY.loadFailed)).toHaveLength(1);
        const sentences = [...alert.querySelectorAll("p")].map((p) => p.textContent);
        expect(sentences).toHaveLength(2);
        expect(sentences[1]).not.toBe(sentences[0]);
        expect(sentences[1]).toMatch(/try again/i);
        // The server's own words never reach the page.
        expect(alert).not.toHaveTextContent("boom");
        const retry = screen.getByRole("button", { name: PRICING_COPY.retry });
        expect(retry).toHaveAttribute("type", "button");
        await userEvent.click(retry);

        await waitFor(() => expect(mockedGetPlans).toHaveBeenCalledTimes(2));
        // The button has gone; the keyboard stays in the part it belonged to.
        expect(container.querySelector('[data-slot="pricing-region"]')).toHaveFocus();
        expect(await screen.findByText("Team plan")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});

describe("plansGridClassName", () => {
    it("draws as many columns as there are plans to compare, up to three", () => {
        expect(plansGridClassName(1)).not.toMatch(/grid-cols-/);
        expect(plansGridClassName(1)).toContain("max-w-md");
        expect(plansGridClassName(2)).toContain("sm:grid-cols-2");
        expect(plansGridClassName(2)).not.toContain("lg:grid-cols-3");
        expect(plansGridClassName(3)).toContain("lg:grid-cols-3");
        expect(plansGridClassName(7)).toBe(plansGridClassName(3));
    });
});
