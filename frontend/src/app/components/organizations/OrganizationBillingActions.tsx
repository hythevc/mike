// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useSyncExternalStore } from "react";
import type { OrgPlanView, PublicPlan } from "@mike/contracts";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import {
  createOrgCheckoutSession,
  createOrgPortalSession,
  getPlans,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

// The checkout and portal controls on an organization's Plan card. They exist
// only on a deployment that reports billing enabled (view.billing_enabled);
// with it off this renders nothing, so no upgrade or manage control appears
// anywhere. The pages themselves belong to the payment provider: the browser
// is sent to a hosted checkout or portal and returns to the plan page, where
// the plan updates once the provider has confirmed what happened. Payment
// details are never entered in this app.

type Props = {
  orgId: string;
  view: OrgPlanView;
  /** Owners alone may change the plan or open billing. */
  isOwner: boolean;
};

type PlanList =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; plans: PublicPlan[] }
  | { state: "failed" };

/** The line to show after the provider sent the browser back here. */
export function checkoutNotice(search: string): string | null {
  const outcome = new URLSearchParams(search).get("checkout");
  if (outcome === "success")
    return "Thanks. The plan updates here once the payment provider confirms the payment, usually within a minute; reload to check.";
  if (outcome === "canceled")
    return "Checkout was canceled and nothing was charged.";
  return null;
}

// The query string never changes while this component is mounted (the
// provider's return is a full page load), so nothing to subscribe to.
const subscribeToNothing = () => () => {};
const readSearch = () => window.location.search;
// The server has no query string; React re-reads it on the client after
// hydration, so the notice appears without a hydration mismatch.
const readServerSearch = () => "";

export function OrganizationBillingActions({ orgId, view, isOwner }: Props) {
  const [plans, setPlans] = useState<PlanList>({ state: "idle" });
  // The plan key being checked out, or "portal"; one request at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const search = useSyncExternalStore(subscribeToNothing, readSearch, readServerSearch);
  const notice = checkoutNotice(search);

  if (!view.billing_enabled) return null;

  if (!isOwner)
    return (
      <SettingsDescription>
        Only an organization owner can change the plan or open billing.
      </SettingsDescription>
    );

  async function loadPlans() {
    setPlans({ state: "loading" });
    try {
      const response = await getPlans();
      setPlans({ state: "ready", plans: response.plans });
    } catch {
      setPlans({ state: "failed" });
    }
  }

  async function startCheckout(plan: PublicPlan) {
    setBusy(plan.key);
    try {
      const session = await createOrgCheckoutSession(orgId, plan.key);
      window.location.assign(session.url);
    } catch (error) {
      notifyError(error, {
        action: "start checkout",
        onRetry: () => void startCheckout(plan),
      });
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const session = await createOrgPortalSession(orgId);
      window.location.assign(session.url);
    } catch (error) {
      notifyError(error, {
        action: "open billing",
        onRetry: () => void openPortal(),
      });
      setBusy(null);
    }
  }

  // A live subscription changes through the provider's portal; a new
  // checkout is offered only while there is none.
  const offerCheckout = view.status !== "active";

  return (
    <div className="space-y-3 pt-2">
      {notice ? (
        <p role="status" className="text-sm text-fg-subtle">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {offerCheckout && plans.state === "idle" ? (
          <PillButtonUI tone="black" size="sm" onClick={() => void loadPlans()}>
            Choose a plan
          </PillButtonUI>
        ) : null}
        {view.has_billing_account ? (
          <PillButtonUI
            tone="white"
            size="sm"
            loading={busy === "portal"}
            disabled={busy !== null}
            onClick={() => void openPortal()}
          >
            Manage billing
          </PillButtonUI>
        ) : null}
      </div>
      {plans.state === "loading" ? (
        <p className="text-sm text-fg-subtle" aria-busy="true">
          Loading plans…
        </p>
      ) : null}
      {plans.state === "failed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <SettingsDescription>Could not load the plans.</SettingsDescription>
          <PillButtonUI tone="white" size="sm" onClick={() => void loadPlans()}>
            Try again
          </PillButtonUI>
        </div>
      ) : null}
      {plans.state === "ready" && plans.plans.length === 0 ? (
        <SettingsDescription>No plans are on offer right now.</SettingsDescription>
      ) : null}
      {plans.state === "ready" && plans.plans.length > 0 ? (
        <ul className="space-y-2" aria-label="Plans on offer">
          {plans.plans.map((plan) => (
            <li
              key={plan.key}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3"
            >
              <div className="min-w-0 space-y-1">
                <SettingsLabel>{plan.name}</SettingsLabel>
                {plan.display_price_text ? (
                  <SettingsDescription>{plan.display_price_text}</SettingsDescription>
                ) : null}
                {plan.description ? (
                  <SettingsDescription>{plan.description}</SettingsDescription>
                ) : null}
              </div>
              <PillButtonUI
                tone="black"
                size="sm"
                aria-label={`Continue to checkout: ${plan.name}`}
                loading={busy === plan.key}
                disabled={busy !== null}
                onClick={() => void startCheckout(plan)}
              >
                Continue to checkout
              </PillButtonUI>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
