// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrgPlanView } from "@mike/contracts";
import { OrganizationPlanSettings } from "./OrganizationPlanSettings";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getOrgPlan: vi.fn(),
  org: { id: "org-1", name: "Firm", role: "owner" } as {
    id: string;
    name: string;
    role: "owner" | "admin" | "member";
  } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./OrganizationSettingsShell", () => ({
  useOrganizationSettings: () => ({ orgId: "org-1", org: mocks.org }),
  organizationSettingsHref: () => "/organizations/org-1/settings",
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getOrgPlan: mocks.getOrgPlan,
}));

function view(over: Partial<OrgPlanView> = {}): OrgPlanView {
  return {
    plans_enabled: true,
    billing_enabled: false,
    has_billing_account: false,
    plan: {
      key: "included",
      name: "Included AI",
      description: "A pooled page allowance.",
      seat_limit: 25,
      features: [],
      deployment_token_allowance: 1_000_000,
      trial_days: 14,
      sort_order: 1,
      display_price_text: "$199",
    },
    status: "active",
    seats_used: 3,
    pending_invites: 1,
    seat_limit: 25,
    trial_ends_at: null,
    current_period_end: null,
    usage: [
      {
        model: "claude-sonnet",
        provider: "anthropic",
        key_source: "env",
        input_tokens: 1000,
        output_tokens: 500,
        cached_tokens: 0,
        calls: 2,
        estimated: false,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.getOrgPlan.mockReset();
  mocks.org = { id: "org-1", name: "Firm", role: "owner" };
});

describe("OrganizationPlanSettings", () => {
  it("shows the plan, seats and usage for an owner", async () => {
    mocks.getOrgPlan.mockResolvedValue(view());
    render(<OrganizationPlanSettings />);

    expect(await screen.findByText("Included AI")).toBeInTheDocument();
    expect(screen.getByText("3 of 25 seats used")).toBeInTheDocument();
    expect(
      screen.getByText(/1 pending invitation holds a seat/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI usage this month" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
    // 1000 + 500 input/output.
    expect(screen.getByText("1,500")).toBeInTheDocument();
  });

  it("says plans are not enabled when the deployment runs none", async () => {
    mocks.getOrgPlan.mockResolvedValue(
      view({ plans_enabled: false, plan: null, status: null, seat_limit: null }),
    );
    render(<OrganizationPlanSettings />);
    expect(
      await screen.findByText(/Plans are not enabled on this deployment/),
    ).toBeInTheDocument();
    // No seat limit: a count, not "of N".
    expect(screen.getByText("3 seats used")).toBeInTheDocument();
  });

  it("shows an empty-usage line and no table when there is no usage", async () => {
    mocks.getOrgPlan.mockResolvedValue(view({ usage: [] }));
    render(<OrganizationPlanSettings />);
    expect(
      await screen.findByText("No AI usage recorded this month."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("refuses the section to a member", () => {
    mocks.org = { id: "org-1", name: "Firm", role: "member" };
    render(<OrganizationPlanSettings />);
    expect(
      screen.getByText(/Only this organization's owners and admins can see/),
    ).toBeInTheDocument();
    expect(mocks.getOrgPlan).not.toHaveBeenCalled();
  });

  it("offers Try again when the plan cannot be loaded", async () => {
    mocks.getOrgPlan.mockRejectedValue(new Error("boom"));
    render(<OrganizationPlanSettings />);
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("shows no upgrade or manage control while billing is off", async () => {
    mocks.getOrgPlan.mockResolvedValue(
      view({ billing_enabled: false, status: "trialing", has_billing_account: false }),
    );
    render(<OrganizationPlanSettings />);
    expect(await screen.findByText("Included AI")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose a plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument();
  });

  it("offers an owner the plan and billing controls once billing is on", async () => {
    mocks.getOrgPlan.mockResolvedValue(
      view({ billing_enabled: true, status: "trialing", has_billing_account: true }),
    );
    render(<OrganizationPlanSettings />);
    expect(await screen.findByRole("button", { name: "Choose a plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
  });

  it("offers an admin no billing control even when billing is on", async () => {
    mocks.org = { id: "org-1", name: "Firm", role: "admin" };
    mocks.getOrgPlan.mockResolvedValue(
      view({ billing_enabled: true, status: "trialing", has_billing_account: true }),
    );
    render(<OrganizationPlanSettings />);
    expect(await screen.findByText("Included AI")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose a plan|manage billing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an organization owner can change the plan/)).toBeInTheDocument();
  });
});
