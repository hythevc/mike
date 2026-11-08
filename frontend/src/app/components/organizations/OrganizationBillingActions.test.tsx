// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OrgPlanView } from "@mike/contracts";
import { MikeApiError } from "@/app/lib/mikeApi";
import {
  OrganizationBillingActions,
  checkoutNotice,
  offersCheckout,
} from "./OrganizationBillingActions";

const mocks = vi.hoisted(() => ({
  getPlans: vi.fn(),
  createOrgCheckoutSession: vi.fn(),
  createOrgPortalSession: vi.fn(),
  notifyError: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getPlans: mocks.getPlans,
  createOrgCheckoutSession: mocks.createOrgCheckoutSession,
  createOrgPortalSession: mocks.createOrgPortalSession,
}));

vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: mocks.notifyError,
}));

// The step-up prompt is two buttons, one that reports success and one that
// dismisses it; the real popup has its own tests.
vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: ({
    open,
    onCancel,
    onVerified,
  }: {
    open: boolean;
    onCancel: () => void;
    onVerified: () => void;
  }) =>
    open ? (
      <>
        <button type="button" onClick={onVerified}>
          Verify MFA
        </button>
        <button type="button" onClick={onCancel}>
          Cancel MFA
        </button>
      </>
    ) : null,
}));

const PLAN = {
  key: "included",
  name: "Included AI",
  description: "A pooled allowance.",
  seat_limit: 25,
  features: [],
  deployment_token_allowance: 1_000_000,
  trial_days: 14,
  sort_order: 1,
  display_price_text: "$0 placeholder",
};

const PLANS_RESPONSE = { plans_enabled: true, billing_enabled: true, plans: [PLAN] };

/** The exact refusal the server's step-up guard sends. */
const mfaRequired = () =>
  new MikeApiError({
    message: "MFA verification required",
    status: 403,
    code: "mfa_verification_required",
  });

function view(over: Partial<OrgPlanView> = {}): OrgPlanView {
  return {
    plans_enabled: true,
    billing_enabled: true,
    has_billing_account: false,
    plan: null,
    status: "trialing",
    seats_used: 1,
    pending_invites: 0,
    seat_limit: null,
    trial_ends_at: null,
    current_period_end: null,
    usage: [],
    ...over,
  };
}

const originalLocation = window.location;

beforeEach(() => {
  mocks.getPlans.mockReset();
  mocks.createOrgCheckoutSession.mockReset();
  mocks.createOrgPortalSession.mockReset();
  mocks.notifyError.mockReset();
  mocks.assign.mockReset();
  // jsdom does not navigate; stand in for the one call that would.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "", assign: mocks.assign },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe("offersCheckout", () => {
  it("offers a new checkout only while no subscription is live", () => {
    expect(offersCheckout({ status: null, has_billing_account: false })).toBe(true);
    expect(offersCheckout({ status: "none", has_billing_account: true })).toBe(true);
    // A canceled workspace may buy again; its billing account holds the invoices.
    expect(offersCheckout({ status: "canceled", has_billing_account: true })).toBe(true);
    expect(offersCheckout({ status: "trialing", has_billing_account: false })).toBe(true);
    // A trial that already holds a billing account: a checkout completed
    // with its payment pending, so a subscription exists.
    expect(offersCheckout({ status: "trialing", has_billing_account: true })).toBe(false);
    expect(offersCheckout({ status: "active", has_billing_account: true })).toBe(false);
    // The provider keeps retrying the payment; the portal fixes the method.
    expect(offersCheckout({ status: "past_due", has_billing_account: true })).toBe(false);
  });
});

describe("OrganizationBillingActions", () => {
  it("renders nothing while billing is off", () => {
    const { container } = render(
      <OrganizationBillingActions orgId="org-1" view={view({ billing_enabled: false })} isOwner />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells an admin the plan is an owner's decision and offers no control", () => {
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner={false} />);
    expect(
      screen.getByText(/Only an organization owner can change the plan/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists the plans on offer and sends the owner to the checkout", async () => {
    mocks.getPlans.mockResolvedValue(PLANS_RESPONSE);
    mocks.createOrgCheckoutSession.mockResolvedValue({ url: "https://billing.invalid/checkout/1" });
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);

    // No live subscription: a checkout is offered; no customer yet: no portal.
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();

    const choose = await screen.findByRole("button", {
      name: "Continue to checkout: Included AI",
    });
    expect(screen.getByRole("group", { name: "Plans on offer" })).toBeInTheDocument();
    expect(screen.getByText("$0 placeholder")).toBeInTheDocument();
    fireEvent.click(choose);

    await waitFor(() =>
      expect(mocks.createOrgCheckoutSession).toHaveBeenCalledWith("org-1", "included"),
    );
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith("https://billing.invalid/checkout/1"),
    );
  });

  it("shows placeholder rows, not a text line, while the plans load", async () => {
    let resolvePlans: (value: typeof PLANS_RESPONSE) => void = () => {};
    mocks.getPlans.mockReturnValue(
      new Promise<typeof PLANS_RESPONSE>((resolve) => {
        resolvePlans = resolve;
      }),
    );
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(screen.getByRole("status", { name: "Loading plans" })).toBeInTheDocument();
    expect(screen.queryByText(/Loading plans…/)).not.toBeInTheDocument();
    // The offer is withdrawn while the list is on its way.
    expect(screen.queryByRole("button", { name: "Choose a plan" })).not.toBeInTheDocument();

    resolvePlans(PLANS_RESPONSE);
    expect(
      await screen.findByRole("button", { name: "Continue to checkout: Included AI" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading plans" })).not.toBeInTheDocument();
  });

  it("opens the portal for a workspace with a billing account and offers no second checkout while active", async () => {
    mocks.createOrgPortalSession.mockResolvedValue({ url: "https://billing.invalid/portal/1" });
    render(
      <OrganizationBillingActions
        orgId="org-1"
        view={view({ status: "active", has_billing_account: true })}
        isOwner
      />,
    );
    expect(screen.queryByRole("button", { name: "Choose a plan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(mocks.createOrgPortalSession).toHaveBeenCalledWith("org-1"));
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith("https://billing.invalid/portal/1"),
    );
  });

  it("shows a past-due owner Manage billing but no new checkout", () => {
    render(
      <OrganizationBillingActions
        orgId="org-1"
        view={view({ status: "past_due", has_billing_account: true })}
        isOwner
      />,
    );
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a plan" })).not.toBeInTheDocument();
    expect(mocks.getPlans).not.toHaveBeenCalled();
  });

  it("offers no new checkout while a trial already holds a billing account, and lets a canceled workspace buy again", () => {
    const { rerender } = render(
      <OrganizationBillingActions
        orgId="org-1"
        view={view({ status: "trialing", has_billing_account: true })}
        isOwner
      />,
    );
    expect(screen.queryByRole("button", { name: "Choose a plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();

    rerender(
      <OrganizationBillingActions
        orgId="org-1"
        view={view({ status: "canceled", has_billing_account: true })}
        isOwner
      />,
    );
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
  });

  it("asks for the second factor the server requires, then starts the checkout again", async () => {
    mocks.getPlans.mockResolvedValue(PLANS_RESPONSE);
    mocks.createOrgCheckoutSession
      .mockRejectedValueOnce(mfaRequired())
      .mockResolvedValueOnce({ url: "https://billing.invalid/checkout/2" });
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue to checkout: Included AI" }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Verify MFA" }));
    await waitFor(() => expect(mocks.createOrgCheckoutSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith("https://billing.invalid/checkout/2"),
    );
    // The refusal is a prompt, not a failure notice.
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("asks for the second factor before the portal too; a dismissed prompt drops the request, a passed one sends it again", async () => {
    mocks.createOrgPortalSession
      .mockRejectedValueOnce(mfaRequired())
      .mockRejectedValueOnce(mfaRequired())
      .mockResolvedValueOnce({ url: "https://billing.invalid/portal/2" });
    render(
      <OrganizationBillingActions
        orgId="org-1"
        view={view({ status: "active", has_billing_account: true })}
        isOwner
      />,
    );
    const manage = screen.getByRole("button", { name: "Manage billing" });

    // Dismissed: nothing is sent again, no failure notice, the control is free.
    fireEvent.click(manage);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel MFA" }));
    expect(screen.queryByRole("button", { name: "Verify MFA" })).not.toBeInTheDocument();
    expect(mocks.createOrgPortalSession).toHaveBeenCalledTimes(1);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(manage).not.toBeDisabled();

    // Passed: the portal request goes out again and the browser is sent on.
    fireEvent.click(manage);
    fireEvent.click(await screen.findByRole("button", { name: "Verify MFA" }));
    await waitFor(() => expect(mocks.createOrgPortalSession).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith("https://billing.invalid/portal/2"),
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports a failed checkout through notifyError and lets the owner try again", async () => {
    mocks.getPlans.mockResolvedValue(PLANS_RESPONSE);
    mocks.createOrgCheckoutSession.mockRejectedValue(new Error("boom"));
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    const choose = await screen.findByRole("button", {
      name: "Continue to checkout: Included AI",
    });
    fireEvent.click(choose);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect(mocks.notifyError.mock.calls[0][1]).toMatchObject({ action: "start checkout" });
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Verify MFA" })).not.toBeInTheDocument();
    await waitFor(() => expect(choose).not.toBeDisabled());
  });

  it("offers Try again when the plans cannot be loaded", async () => {
    mocks.getPlans.mockRejectedValueOnce(new Error("boom"));
    mocks.getPlans.mockResolvedValueOnce({ plans_enabled: true, billing_enabled: true, plans: [] });
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No plans are on offer right now.")).toBeInTheDocument();
  });

  it("moves focus along with the list: to the placeholder rows, then to the plans on offer", async () => {
    let resolvePlans: (value: typeof PLANS_RESPONSE) => void = () => {};
    mocks.getPlans.mockReturnValue(
      new Promise<typeof PLANS_RESPONSE>((resolve) => {
        resolvePlans = resolve;
      }),
    );
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    const choose = screen.getByRole("button", { name: "Choose a plan" });
    choose.focus();
    fireEvent.click(choose);
    // The pressed control is gone; focus rests on the rows standing in for the list.
    expect(screen.getByRole("status", { name: "Loading plans" })).toHaveFocus();

    await act(async () => {
      resolvePlans(PLANS_RESPONSE);
    });
    const group = screen.getByRole("group", { name: "Plans on offer" });
    expect(group).toHaveFocus();
    // Tab from the group reaches the first plan's checkout.
    expect(within(group).getAllByRole("button")[0]).toHaveAccessibleName(
      "Continue to checkout: Included AI",
    );
  });

  it("moves focus to Try again when the plans cannot be loaded, and to the message when none are on offer", async () => {
    mocks.getPlans.mockRejectedValueOnce(new Error("boom"));
    mocks.getPlans.mockResolvedValueOnce({ plans_enabled: true, billing_enabled: true, plans: [] });
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    const choose = screen.getByRole("button", { name: "Choose a plan" });
    choose.focus();
    fireEvent.click(choose);
    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.click(retry);
    expect(screen.getByRole("status", { name: "Loading plans" })).toHaveFocus();
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent("No plans are on offer right now."),
    );
  });

  it("leaves focus where the owner moved it while the plans were loading", async () => {
    let resolvePlans: (value: typeof PLANS_RESPONSE) => void = () => {};
    mocks.getPlans.mockReturnValue(
      new Promise<typeof PLANS_RESPONSE>((resolve) => {
        resolvePlans = resolve;
      }),
    );
    render(
      <OrganizationBillingActions
        orgId="org-1"
        view={view({ status: "canceled", has_billing_account: true })}
        isOwner
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    const manage = screen.getByRole("button", { name: "Manage billing" });
    manage.focus();

    await act(async () => {
      resolvePlans(PLANS_RESPONSE);
    });
    expect(screen.getByRole("group", { name: "Plans on offer" })).toBeInTheDocument();
    expect(manage).toHaveFocus();
  });

  it("shows the outcome line after the provider sends the browser back", () => {
    expect(checkoutNotice("?checkout=success")).toMatch(/plan updates here/);
    expect(checkoutNotice("?checkout=canceled")).toMatch(/nothing was charged/);
    expect(checkoutNotice("")).toBeNull();
    expect(checkoutNotice("?checkout=other")).toBeNull();

    window.location.search = "?checkout=canceled";
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);
    expect(screen.getByRole("status")).toHaveTextContent(/nothing was charged/);
  });
});
