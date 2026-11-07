// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import type { OrgPlanView } from "@mike/contracts";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { getPersonalPlan } from "@/app/lib/mikeApi";

// The Usage Plan card on a person's own settings. It reads the plan of their
// personal workspace rather than a fixed tier: plans are off by default, and
// then the card says AI use is not metered by a plan. When plans are on it
// shows the plan and this month's AI use. A failed read is a quiet line, never
// a popup, so the settings page still renders.

const STATUS_LABELS: Record<NonNullable<OrgPlanView["status"]>, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  none: "No plan",
};

export function PersonalPlanCard() {
  const [view, setView] = useState<OrgPlanView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getPersonalPlan()
      .then((plan) => {
        if (active) setView(plan);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const tokens = view
    ? view.usage.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0)
    : 0;

  return (
    <section className="space-y-3">
      <SettingsHeading id="usage-plan">Usage Plan</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          {loading ? (
            <SkeletonLine className="w-40" />
          ) : failed || !view ? (
            <p className="text-base text-gray-500">
              Plan information is unavailable right now.
            </p>
          ) : !view.plans_enabled ? (
            <p className="text-base text-gray-500">
              AI use on your workspace is not limited by a plan.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-base font-medium">
                {view.plan ? view.plan.name : STATUS_LABELS[view.status ?? "none"]}
              </p>
              <p className="text-sm text-gray-500">
                {tokens > 0
                  ? `${tokens.toLocaleString("en-US")} tokens used this month`
                  : "No AI usage recorded this month"}
              </p>
            </div>
          )}
        </SettingsRow>
      </GlassCardUI>
    </section>
  );
}
