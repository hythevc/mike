// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlansResponse } from "@mike/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRICING_COPY } from "@/content/site/pricing";

vi.mock("@/app/lib/mikeApi", () => ({
    getPlans: vi.fn(),
}));

import { getPlans } from "@/app/lib/mikeApi";
import { PricingPlans } from "./PricingPlans";

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

const CHECKOUT = /checkout|subscribe|buy|purchase|upgrade/i;

beforeEach(() => {
    mockedGetPlans.mockReset();
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
        expect(screen.getByText(PRICING_COPY.billingOffNote)).toBeInTheDocument();
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

    it("says pricing is not available yet when the deployment publishes no plans", async () => {
        mockedGetPlans.mockResolvedValue(NO_PLANS);
        render(<PricingPlans />);
        expect(await screen.findByText(PRICING_COPY.unavailable)).toBeInTheDocument();
        expect(screen.getByText(PRICING_COPY.unavailableDetail)).toBeInTheDocument();
        expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: CHECKOUT })).not.toBeInTheDocument();
    });

    it("shows a loading state first", () => {
        mockedGetPlans.mockReturnValue(new Promise(() => {}));
        render(<PricingPlans />);
        expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    });

    it("shows a failed load with Retry, and loads the plans on retry", async () => {
        mockedGetPlans
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce(WITH_PLANS);
        render(<PricingPlans />);

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(PRICING_COPY.loadFailed);
        await userEvent.click(screen.getByRole("button", { name: PRICING_COPY.retry }));

        await waitFor(() => expect(mockedGetPlans).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("Team plan")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
