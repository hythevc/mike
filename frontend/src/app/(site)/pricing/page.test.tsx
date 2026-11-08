// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PRICING_COPY } from "@/content/site/pricing";

vi.mock("@/app/lib/mikeApi", () => ({
    getPlans: vi.fn().mockResolvedValue({
        plans_enabled: false,
        billing_enabled: false,
        plans: [],
    }),
}));

import PricingPage, { metadata } from "./page";

describe("/pricing", () => {
    it("frames the plans with the heading, the intro and the disclaimer", async () => {
        render(<PricingPage />);
        expect(
            screen.getByRole("heading", { level: 1, name: PRICING_COPY.title }),
        ).toBeInTheDocument();
        expect(screen.getByText(PRICING_COPY.intro)).toBeInTheDocument();
        expect(await screen.findByText(PRICING_COPY.unavailable)).toBeInTheDocument();
        expect(screen.getByText(PRICING_COPY.disclaimer)).toBeInTheDocument();
        expect(String(metadata.title)).toContain(PRICING_COPY.title);
    });
});
