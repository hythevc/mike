// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlansResponse, PublicPlan } from "@mike/contracts";
import { getPlans } from "@/app/lib/mikeApi";
import { describeError } from "@/app/lib/userFacingError";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { pillButtonUIClassName } from "@/shared/ui/PillButtonUI.styles";
import { PRICING_COPY } from "@/content/site/pricing";

type State =
    | { status: "loading" }
    | { status: "loaded"; response: PlansResponse }
    | { status: "failed"; message: string };

/**
 * The plans a deployment offers, read from GET /plans (public). Three
 * honest states: loading, the plans or "not available yet", and a failed
 * load with Retry. Prices are shown as the catalog states them; there is no
 * checkout here, because billing stays off and buying a plan is a matter for
 * the signed-in app when it is ever turned on.
 */
export function PricingPlans() {
    const [state, setState] = useState<State>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        getPlans()
            .then((response) => {
                if (active) setState({ status: "loaded", response });
            })
            .catch((error: unknown) => {
                if (!active) return;
                const described = describeError(error, {
                    action: "load pricing",
                    fallback: PRICING_COPY.loadFailed,
                });
                setState({ status: "failed", message: described.message });
            });
        return () => {
            active = false;
        };
    }, [attempt]);

    if (state.status === "loading") {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
                <span className="sr-only">Loading pricing</span>
                <SkeletonLine className="w-48" />
                <SkeletonLine className="w-72" />
                <SkeletonLine className="w-40" />
            </div>
        );
    }

    if (state.status === "failed") {
        return (
            <div role="alert" className="space-y-3">
                <p className="text-base font-medium text-fg">{PRICING_COPY.loadFailed}</p>
                <p className="text-sm text-fg-subtle">{state.message}</p>
                <PillButtonUI
                    type="button"
                    tone="white"
                    size="normal"
                    onClick={() => {
                        setState({ status: "loading" });
                        setAttempt((n) => n + 1);
                    }}
                >
                    {PRICING_COPY.retry}
                </PillButtonUI>
            </div>
        );
    }

    const { response } = state;
    const plans = [...response.plans].sort((a, b) => a.sort_order - b.sort_order);

    if (plans.length === 0) {
        return (
            <div className="space-y-3">
                <p className="text-lg font-medium text-fg">{PRICING_COPY.unavailable}</p>
                <p className="max-w-2xl text-sm leading-6 text-fg-subtle">
                    {PRICING_COPY.unavailableDetail}
                </p>
                <AccountLinks />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => (
                    <li key={plan.key} className="flex">
                        <PlanCard plan={plan} />
                    </li>
                ))}
            </ul>
            {!response.billing_enabled && (
                <p className="max-w-2xl text-sm leading-6 text-fg-subtle">
                    {PRICING_COPY.billingOffNote}
                </p>
            )}
            <AccountLinks />
        </div>
    );
}

function PlanCard({ plan }: { plan: PublicPlan }) {
    return (
        <GlassCardUI>
            <div className="flex h-full flex-col p-5">
                <h2 className="text-lg font-semibold text-fg">{plan.name}</h2>
                {plan.display_price_text ? (
                    <p className="mt-1 text-2xl font-medium tabular-nums text-fg">
                        {plan.display_price_text}
                    </p>
                ) : null}
                {plan.description ? (
                    <p className="mt-2 text-sm leading-6 text-fg-subtle">{plan.description}</p>
                ) : null}
                <p className="mt-3 text-sm text-fg-muted">
                    {plan.seat_limit === null
                        ? PRICING_COPY.noSeatLimit
                        : PRICING_COPY.seatLimit(plan.seat_limit)}
                    {plan.trial_days ? ` · ${PRICING_COPY.trial(plan.trial_days)}` : ""}
                </p>
                {plan.features.length > 0 ? (
                    <>
                        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                            {PRICING_COPY.featuresHeading}
                        </h3>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-fg-subtle">
                            {plan.features.map((feature) => (
                                <li key={feature}>{feature}</li>
                            ))}
                        </ul>
                    </>
                ) : null}
            </div>
        </GlassCardUI>
    );
}

/** The only calls to action while billing is off: an account, or sign in. */
function AccountLinks() {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <Link
                href="/signup"
                className={pillButtonUIClassName({ tone: "black", size: "normal" })}
            >
                {PRICING_COPY.accountAction}
            </Link>
            <Link
                href="/login"
                className={pillButtonUIClassName({ tone: "white", size: "normal" })}
            >
                {PRICING_COPY.signInAction}
            </Link>
        </div>
    );
}
