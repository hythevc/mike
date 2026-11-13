// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PlansResponse, PublicPlan } from "@mike/contracts";
import { getPlans } from "@/app/lib/mikeApi";
import { describeError } from "@/app/lib/userFacingError";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { PRICING_COPY, type LinkedSentence } from "@/content/site/pricing";
import { formatPlanPrice } from "./planPrice";
import {
    SITE_PRIMARY_ACTION_SLOT,
    SITE_STANDALONE_LINK_CLASS,
    SITE_TEXT_LINK_CLASS,
    sitePrimaryActionClassName,
} from "./siteStyles";
import { TrustStrip } from "./TrustStrip";

type State =
    | { status: "loading" }
    | { status: "loaded"; response: PlansResponse }
    | { status: "failed"; message: string };

/** What the page is showing, for the layout checks and the tests. */
type View = "loading" | "plans" | "unavailable" | "failed";

/**
 * As many columns as there are plans to compare, up to three: one plan is a
 * single card at a readable width, two sit side by side, and three or more
 * fill the row and wrap. The page never draws three columns by habit.
 */
export function plansGridClassName(count: number): string {
    if (count <= 1) return "grid max-w-md gap-4";
    if (count === 2) return "grid gap-4 sm:grid-cols-2";
    return "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";
}

/**
 * The plans a deployment offers, read from GET /plans (public), above the
 * page's one action and the security facts that back it.
 *
 * One frame, four states. Loading, the plans, "not available yet" and a
 * failed load all render the same outer element with the same two parts: the
 * plans region, which is the only part that changes, and the action with its
 * facts, which is there from the first paint and does not wait for the
 * request. Prices are shown as the catalog states them; there is no checkout
 * here, because billing stays off and buying a plan is a matter for the
 * signed-in app when it is ever turned on.
 */
export function PricingPlans() {
    const [state, setState] = useState<State>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const region = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let active = true;
        getPlans()
            .then((response) => {
                if (active) setState({ status: "loaded", response });
            })
            .catch((error: unknown) => {
                if (!active) return;
                // The heading says what did not happen; the description
                // adds the likely cause and what to do, in its own words.
                const described = describeError(error, { action: "load pricing" });
                setState({ status: "failed", message: described.message });
            });
        return () => {
            active = false;
        };
    }, [attempt]);

    const plans =
        state.status === "loaded"
            ? [...state.response.plans].sort((a, b) => a.sort_order - b.sort_order)
            : [];
    const view: View =
        state.status === "loaded" ? (plans.length > 0 ? "plans" : "unavailable") : state.status;

    function retry() {
        setState({ status: "loading" });
        setAttempt((n) => n + 1);
        // The Retry button is about to leave the page; keep the keyboard's
        // place in the region it belonged to instead of dropping it.
        region.current?.focus();
    }

    return (
        <div data-slot="pricing-plans" data-state={view} className="space-y-8">
            <div
                ref={region}
                tabIndex={-1}
                data-slot="pricing-region"
                className="min-h-24 focus-visible:outline-none"
            >
                {view === "loading" ? (
                    <div role="status" aria-busy="true" className="space-y-3">
                        <span className="sr-only">{PRICING_COPY.loading}</span>
                        <SkeletonLine className="w-48" />
                        <SkeletonLine className="w-72 max-w-full" />
                        <SkeletonLine className="w-40" />
                    </div>
                ) : null}

                {state.status === "failed" ? (
                    <div role="alert" className="space-y-3">
                        <p className="text-lg font-medium text-fg">{PRICING_COPY.loadFailed}</p>
                        <p className="max-w-2xl text-sm leading-6 text-fg-subtle">
                            {state.message}
                        </p>
                        <PillButtonUI
                            type="button"
                            tone="white"
                            size="normal"
                            className="h-11 px-5"
                            onClick={retry}
                        >
                            {PRICING_COPY.retry}
                        </PillButtonUI>
                    </div>
                ) : null}

                {view === "unavailable" ? (
                    <div className="space-y-3">
                        <p className="text-lg font-medium text-fg">{PRICING_COPY.unavailable}</p>
                        <p className="max-w-2xl text-sm leading-6 text-fg-subtle">
                            {PRICING_COPY.unavailableDetail}{" "}
                            <Sentence parts={PRICING_COPY.unavailableContact} />
                        </p>
                    </div>
                ) : null}

                {state.status === "loaded" && view === "plans" ? (
                    <>
                        <ul data-slot="plan-list" className={plansGridClassName(plans.length)}>
                            {plans.map((plan) => (
                                <li key={plan.key} className="grid min-w-0">
                                    <PlanCard plan={plan} />
                                </li>
                            ))}
                        </ul>
                        {!state.response.billing_enabled ? (
                            <p className="mt-6 max-w-2xl text-sm leading-6 text-fg-subtle">
                                <Sentence parts={PRICING_COPY.billingOff} />
                            </p>
                        ) : null}
                    </>
                ) : null}
            </div>

            <div data-slot="pricing-actions">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                    <Link
                        href="/signup"
                        data-slot={SITE_PRIMARY_ACTION_SLOT}
                        className={sitePrimaryActionClassName()}
                    >
                        {PRICING_COPY.accountAction}
                    </Link>
                    <Link href="/login" className={SITE_STANDALONE_LINK_CLASS}>
                        {PRICING_COPY.signInAction}
                    </Link>
                </div>
                <div className="mt-5">
                    <TrustStrip />
                </div>
            </div>
        </div>
    );
}

/** A sentence from the copy with its one link rendered as a real link. */
function Sentence({ parts }: { parts: LinkedSentence }) {
    return (
        <>
            {parts.before}
            <Link href={parts.href} className={SITE_TEXT_LINK_CLASS}>
                {parts.link}
            </Link>
            {parts.after}
        </>
    );
}

/**
 * One plan. Everything is on the card: its feature rows are a plain list,
 * never behind a disclosure, so plans can be compared line by line. No plan
 * is marked as recommended; the cards are built the same way on purpose,
 * because they are compared, and differ only in what the catalog says.
 */
function PlanCard({ plan }: { plan: PublicPlan }) {
    const price = formatPlanPrice(plan);
    return (
        <GlassCardUI>
            <div className="flex h-full flex-col p-5 [overflow-wrap:anywhere]">
                <h2 className="text-lg font-medium text-fg">{plan.name}</h2>
                {price ? (
                    <p className="mt-1" data-slot="plan-price">
                        <span className="block text-2xl font-medium tabular-nums text-fg">
                            {price.amount}
                        </span>
                        {price.qualifier ? (
                            <span className="block text-sm text-fg-muted">{price.qualifier}</span>
                        ) : null}
                    </p>
                ) : plan.display_price_text ? (
                    <p
                        className="mt-1 text-2xl font-medium tabular-nums text-fg"
                        data-slot="plan-price"
                    >
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
                        <h3 className="mt-4 text-sm font-medium text-fg">
                            {PRICING_COPY.featuresHeading}
                        </h3>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-fg-subtle marker:text-fg-muted">
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
