// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";
import type { OrgPlanView, PublicPlan } from "@mike/contracts";
import { MfaVerificationPopup } from "@/app/components/popups/MfaVerificationPopup";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import {
  createOrgCheckoutSession,
  createOrgPortalSession,
  getPlans,
  isMfaRequiredError,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

// The checkout and portal controls on an organization's Plan card, rendered
// as further rows of the card below the plan summary. They exist only on a
// deployment that reports billing enabled (view.billing_enabled); with it
// off this renders nothing, so no upgrade or manage control appears
// anywhere. The pages themselves belong to the payment provider: the browser
// is sent to a hosted checkout or portal and returns to the plan page, where
// the plan updates once the provider has confirmed what happened. Payment
// details are never entered in this app.
//
// Both requests are sensitive writes. The server asks a session whose
// account has a second factor enrolled to pass it first; the step-up prompt
// here sends the same request again once it has.
//
// Listing the plans replaces the control that was pressed, so focus is moved
// on with each step rather than left to fall to the page: to the placeholder
// rows while the plans load, then to the plans on offer, or to the message or
// Try again that takes their place.

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

/** The request the server asked a second factor for, to send again after it. */
type PendingAction = { kind: "checkout"; plan: PublicPlan } | { kind: "portal" };

/** The line to show after the provider sent the browser back here. */
export function checkoutNotice(search: string): string | null {
  const outcome = new URLSearchParams(search).get("checkout");
  if (outcome === "success")
    return "Thanks. The plan updates here once the payment provider confirms the payment, usually within a minute; reload to check.";
  if (outcome === "canceled")
    return "Checkout was canceled and nothing was charged.";
  return null;
}

/**
 * Whether a new checkout is offered. A live subscription is changed through
 * the provider's portal, so a second checkout can never stack a second
 * subscription on the same customer: not while active, not while past due
 * (the provider is still retrying the payment; the portal is where the
 * payment method is fixed), and not on a trial that already holds a billing
 * account (a checkout completed with its payment pending). A workspace on no
 * plan, a canceled one, or a trial with no billing account yet can buy. The
 * server applies the same rule.
 */
export function offersCheckout(
  view: Pick<OrgPlanView, "status" | "has_billing_account">,
): boolean {
  if (view.status === "active" || view.status === "past_due") return false;
  if (view.status === "trialing" && view.has_billing_account) return false;
  return true;
}

// The query string never changes while this component is mounted (the
// provider's return is a full page load), so nothing to subscribe to.
const subscribeToNothing = () => () => {};
const readSearch = () => window.location.search;
// The server has no query string; React re-reads it on the client after
// hydration, so the notice appears without a hydration mismatch.
const readServerSearch = () => "";

/** The ring a container shows when focus is sent to it from the keyboard. */
const FOCUS_RING_CLASS =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";

/**
 * Whether focus may be moved without taking it from where the owner put it:
 * it has been lost to the page (the control that had it was removed), or it
 * is still on `previous`, the element that last had it on purpose.
 */
function focusIsFree(previous: Element | null): boolean {
  const active = document.activeElement;
  return (
    !active || active === document.body || (previous !== null && active === previous)
  );
}

/** Placeholder rows the height of a plan row (name, price, description, button). */
function PlanRowsSkeleton({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      role="status"
      aria-label="Loading plans"
      aria-busy="true"
      // Focus rests here while the plans load, so it is not lost to the page.
      tabIndex={-1}
      className={`border-t border-border ${FOCUS_RING_CLASS}`}
    >
      {[0, 1].map((index) => (
        <SettingsRow key={index}>
          <div className="min-w-0 space-y-3">
            <SkeletonLine className="w-40" />
            <SkeletonLine className="w-24" />
            <SkeletonLine className="w-64 max-w-full" />
          </div>
          <SkeletonLine className="h-7 w-36 shrink-0 rounded-full" />
        </SettingsRow>
      ))}
    </div>
  );
}

export function OrganizationBillingActions({ orgId, view, isOwner }: Props) {
  const [plans, setPlans] = useState<PlanList>({ state: "idle" });
  // The plan key being checked out, or "portal"; one request at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingMfa, setPendingMfa] = useState<PendingAction | null>(null);
  const search = useSyncExternalStore(subscribeToNothing, readSearch, readServerSearch);
  const notice = checkoutNotice(search);
  const loadingRef = useRef<HTMLDivElement>(null);
  const failedRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  // What this component last sent focus to, so a later step moves it on only
  // while the owner has left it there.
  const focused = useRef<Element | null>(null);

  // Each step of listing the plans replaces the control that had focus:
  // Choose a plan gives way to the placeholder rows, and those to the plans
  // on offer, or to the message or Try again that takes their place.
  useEffect(() => {
    if (plans.state === "idle" || !focusIsFree(focused.current)) return;
    const target =
      plans.state === "loading"
        ? loadingRef.current
        : plans.state === "failed"
          ? failedRef.current?.querySelector<HTMLElement>("button")
          : plans.plans.length > 0
            ? groupRef.current
            : emptyRef.current;
    target?.focus();
    focused.current = target ?? null;
  }, [plans]);

  if (!view.billing_enabled) return null;

  if (!isOwner)
    return (
      <SettingsRow layout="stacked">
        <SettingsDescription>
          Only an organization owner can change the plan or open billing.
        </SettingsDescription>
      </SettingsRow>
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
      setBusy(null);
      if (isMfaRequiredError(error)) {
        setPendingMfa({ kind: "checkout", plan });
        return;
      }
      notifyError(error, {
        action: "start checkout",
        onRetry: () => void startCheckout(plan),
      });
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const session = await createOrgPortalSession(orgId);
      window.location.assign(session.url);
    } catch (error) {
      setBusy(null);
      if (isMfaRequiredError(error)) {
        setPendingMfa({ kind: "portal" });
        return;
      }
      notifyError(error, {
        action: "open billing",
        onRetry: () => void openPortal(),
      });
    }
  }

  const offerCheckout = offersCheckout(view) && plans.state === "idle";
  const emptyList = plans.state === "ready" && plans.plans.length === 0;
  // The controls row is drawn only while it has something to say; once the
  // plans are listed and there is no portal to open, the rows below stand
  // on their own.
  const showControls =
    notice !== null ||
    offerCheckout ||
    view.has_billing_account ||
    plans.state === "failed" ||
    emptyList;

  return (
    <>
      {showControls ? (
        <SettingsRow layout="stacked">
          {notice ? (
            <div role="status">
              <SettingsDescription>{notice}</SettingsDescription>
            </div>
          ) : null}
          {offerCheckout || view.has_billing_account ? (
            <div className="flex flex-wrap gap-2">
              {offerCheckout ? (
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
          ) : null}
          {plans.state === "failed" ? (
            <div ref={failedRef} className="flex flex-wrap items-center gap-2">
              <SettingsDescription>Could not load the plans.</SettingsDescription>
              <PillButtonUI tone="white" size="sm" onClick={() => void loadPlans()}>
                Try again
              </PillButtonUI>
            </div>
          ) : null}
          {emptyList ? (
            // Read out where the list would have appeared.
            <div ref={emptyRef} tabIndex={-1} className={FOCUS_RING_CLASS}>
              <SettingsDescription>No plans are on offer right now.</SettingsDescription>
            </div>
          ) : null}
        </SettingsRow>
      ) : null}
      {plans.state === "loading" ? <PlanRowsSkeleton ref={loadingRef} /> : null}
      {plans.state === "ready" && plans.plans.length > 0 ? (
        // The first row inside the group drops its own hairline, so the
        // group carries the one that separates it from the row above. Focus
        // lands on the group once the plans are listed; Tab reaches the first.
        <div
          ref={groupRef}
          role="group"
          aria-label="Plans on offer"
          tabIndex={-1}
          className={`border-t border-border ${FOCUS_RING_CLASS}`}
        >
          {plans.plans.map((plan) => (
            <SettingsRow key={plan.key}>
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
                className="w-full shrink-0 sm:w-auto"
              >
                Continue to checkout
              </PillButtonUI>
            </SettingsRow>
          ))}
        </div>
      ) : null}
      <MfaVerificationPopup
        open={pendingMfa !== null}
        onCancel={() => setPendingMfa(null)}
        onVerified={() => {
          const pending = pendingMfa;
          setPendingMfa(null);
          if (!pending) return;
          if (pending.kind === "checkout") void startCheckout(pending.plan);
          else void openPortal();
        }}
        title="Two-factor verification required"
        message="Billing is sensitive. Enter a code from your authenticator app to continue."
      />
    </>
  );
}
