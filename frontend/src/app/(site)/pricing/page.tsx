// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { PricingPlans } from "@/app/components/site/PricingPlans";
import { PRICING_COPY } from "@/content/site/pricing";
import { brand } from "@/shared/brand.generated";

export const metadata: Metadata = {
    title: `${PRICING_COPY.title} · ${brand.productName}`,
    description: PRICING_COPY.intro,
};

/**
 * The public pricing page. The plans come from GET /plans at request time in
 * the browser (PricingPlans); this page is the frame around them.
 */
export default function PricingPage() {
    return (
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
            <h1
                className="text-3xl font-medium tracking-tight text-fg sm:text-4xl"
                style={{ fontFamily: "var(--brand-display-face)" }}
            >
                {PRICING_COPY.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-fg-subtle">
                {PRICING_COPY.intro}
            </p>
            <div className="mt-10">
                <PricingPlans />
            </div>
            <p className="mt-12 text-sm text-fg-muted">{PRICING_COPY.disclaimer}</p>
        </main>
    );
}
