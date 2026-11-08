// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OrgPlanView } from "@mike/contracts";
import {
  OrganizationBillingActions,
  checkoutNotice,
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
    mocks.getPlans.mockResolvedValue({ plans_enabled: true, billing_enabled: true, plans: [PLAN] });
    mocks.createOrgCheckoutSession.mockResolvedValue({ url: "https://billing.invalid/checkout/1" });
    render(<OrganizationBillingActions orgId="org-1" view={view()} isOwner />);

    // No live subscription: a checkout is offered; no customer yet: no portal.
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();

    const choose = await screen.findByRole("button", {
      name: "Continue to checkout: Included AI",
    });
    expect(screen.getByText("$0 placeholder")).toBeInTheDocument();
    fireEvent.click(choose);

    await waitFor(() =>
      expect(mocks.createOrgCheckoutSession).toHaveBeenCalledWith("org-1", "included"),
    );
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith("https://billing.invalid/checkout/1"),
    );
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

  it("reports a failed checkout through notifyError and lets the owner try again", async () => {
    mocks.getPlans.mockResolvedValue({ plans_enabled: true, billing_enabled: true, plans: [PLAN] });
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
