// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrgPlanView } from "@mike/contracts";
import { PersonalPlanCard } from "./PersonalPlanCard";

const mocks = vi.hoisted(() => ({ getPersonalPlan: vi.fn() }));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getPersonalPlan: mocks.getPersonalPlan,
}));

function view(over: Partial<OrgPlanView> = {}): OrgPlanView {
  return {
    plans_enabled: false,
    billing_enabled: false,
    plan: null,
    status: null,
    seats_used: 1,
    pending_invites: 0,
    seat_limit: null,
    trial_ends_at: null,
    current_period_end: null,
    usage: [],
    ...over,
  };
}

beforeEach(() => {
  mocks.getPersonalPlan.mockReset();
});

describe("PersonalPlanCard", () => {
  it("shows the Usage Plan heading and never a fixed Free tier", async () => {
    mocks.getPersonalPlan.mockResolvedValue(view());
    render(<PersonalPlanCard />);
    expect(screen.getByRole("heading", { name: "Usage Plan" })).toBeInTheDocument();
    expect(
      await screen.findByText("AI use on your workspace is not limited by a plan."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Free$/)).not.toBeInTheDocument();
  });

  it("shows the plan name and this month's tokens when plans are on", async () => {
    mocks.getPersonalPlan.mockResolvedValue(
      view({
        plans_enabled: true,
        status: "trialing",
        plan: {
          key: "byok",
          name: "Bring your own key",
          description: "",
          seat_limit: 1,
          features: [],
          deployment_token_allowance: null,
          trial_days: 14,
          sort_order: 1,
          display_price_text: "$79",
        },
        usage: [
          {
            model: "claude-sonnet",
            provider: "anthropic",
            key_source: "env",
            input_tokens: 800,
            output_tokens: 200,
            cached_tokens: 0,
            calls: 1,
            estimated: false,
          },
        ],
      }),
    );
    render(<PersonalPlanCard />);
    expect(await screen.findByText("Bring your own key")).toBeInTheDocument();
    expect(screen.getByText("1,000 tokens used this month")).toBeInTheDocument();
  });

  it("stays quiet, not a popup, when the plan cannot be read", async () => {
    mocks.getPersonalPlan.mockRejectedValue(new Error("boom"));
    render(<PersonalPlanCard />);
    expect(
      await screen.findByText("Plan information is unavailable right now."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Free$/)).not.toBeInTheDocument();
  });
});
