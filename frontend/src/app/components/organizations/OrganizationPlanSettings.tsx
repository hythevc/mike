// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrgPlanView } from "@mike/contracts";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { EmptyState } from "@/app/components/ui/empty-state";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { getOrgPlan } from "@/app/lib/mikeApi";
import { isOrgAdmin } from "@/app/lib/permissions";
import { userFacingApiError } from "@/app/lib/userFacingError";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "./OrganizationSettingsShell";

// The Plan and usage section of an organization's settings: its owners' and
// admins' alone. It shows the plan the workspace is on, the seats in use
// against the limit, and this month's AI usage, read back from the usage
// ledger. Plans and billing are off by default; when plans are off the
// section says so and still shows seats and usage. There is no upgrade control
// while billing is off.

const STATUS_LABELS: Record<NonNullable<OrgPlanView["status"]>, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  none: "No plan",
};

function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function OrganizationPlanSettings() {
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();
  const [view, setView] = useState<OrgPlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = org === null || isOrgAdmin(org.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await getOrgPlan(orgId));
      setError(null);
    } catch (err) {
      setError(userFacingApiError(err, "Could not load this plan."));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    // Only the people who may see the section load it.
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load]);

  if (org && !isOrgAdmin(org.role))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title="Plan and usage"
        description="Only this organization's owners and admins can see its plan and usage."
        action={
          <PillButtonUI
            tone="white"
            size="sm"
            onClick={() => router.push(organizationSettingsHref(orgId))}
          >
            Back to General
          </PillButtonUI>
        }
      />
    );

  if (loading)
    return (
      <div className="space-y-3" aria-busy="true">
        <GlassCardUI>
          <div className="space-y-3 p-1">
            <SkeletonLine className="w-40" />
            <SkeletonLine className="w-64" />
          </div>
        </GlassCardUI>
      </div>
    );

  if (error || !view)
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title="Plan and usage"
        description={error ?? "Could not load this plan."}
        tone="error"
        action={
          <PillButtonUI tone="black" size="sm" onClick={() => void load()}>
            Try again
          </PillButtonUI>
        }
      />
    );

  const seatsLine =
    view.seat_limit === null
      ? `${formatInt(view.seats_used)} ${view.seats_used === 1 ? "seat" : "seats"} used`
      : `${formatInt(view.seats_used)} of ${formatInt(view.seat_limit)} seats used`;
  const trialEnds = formatDate(view.trial_ends_at);
  const hasEstimate = view.usage.some((row) => row.estimated);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SettingsHeading id="plan">Plan</SettingsHeading>
        <GlassCardUI>
          <SettingsRow layout="stacked">
            {!view.plans_enabled ? (
              <SettingsDescription>
                Plans are not enabled on this deployment. Every workspace has
                full access.
              </SettingsDescription>
            ) : (
              <div className="space-y-1">
                <SettingsLabel>
                  {view.plan ? view.plan.name : "No plan"}
                </SettingsLabel>
                <SettingsDescription>
                  {view.status ? STATUS_LABELS[view.status] : "No subscription"}
                  {view.plan?.display_price_text
                    ? ` · ${view.plan.display_price_text}`
                    : ""}
                  {view.status === "trialing" && trialEnds
                    ? ` · Trial ends ${trialEnds}`
                    : ""}
                </SettingsDescription>
                {view.plan?.description ? (
                  <SettingsDescription>
                    {view.plan.description}
                  </SettingsDescription>
                ) : null}
              </div>
            )}
          </SettingsRow>
        </GlassCardUI>
      </section>

      <section className="space-y-3">
        <SettingsHeading id="seats">Seats</SettingsHeading>
        <GlassCardUI>
          <SettingsRow layout="stacked">
            <div className="space-y-1">
              <SettingsLabel>{seatsLine}</SettingsLabel>
              {view.pending_invites > 0 ? (
                <SettingsDescription>
                  {formatInt(view.pending_invites)} pending{" "}
                  {view.pending_invites === 1 ? "invitation" : "invitations"}{" "}
                  {view.pending_invites === 1 ? "holds" : "hold"} a seat until
                  answered.
                </SettingsDescription>
              ) : null}
            </div>
          </SettingsRow>
        </GlassCardUI>
      </section>

      <section className="space-y-3">
        <SettingsHeading id="usage">AI usage this month</SettingsHeading>
        <GlassCardUI>
          {view.usage.length === 0 ? (
            <SettingsRow layout="stacked">
              <SettingsDescription>
                No AI usage recorded this month.
              </SettingsDescription>
            </SettingsRow>
          ) : (
            <div className="overflow-x-auto p-1">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  AI usage this month by model and key source
                </caption>
                <thead>
                  <tr className="text-left text-gray-500">
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Model
                    </th>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Key
                    </th>
                    <th scope="col" className="py-1 pr-4 text-right font-medium">
                      Tokens
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Calls
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.usage.map((row, index) => (
                    <tr key={`${row.model}-${row.key_source}-${index}`}>
                      <th scope="row" className="py-1 pr-4 font-normal">
                        {row.model}
                        {row.estimated ? " *" : ""}
                      </th>
                      <td className="py-1 pr-4">{KEY_SOURCE_LABELS[row.key_source]}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">
                        {formatInt(row.input_tokens + row.output_tokens)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {formatInt(row.calls)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasEstimate ? (
                <p className="mt-2 text-xs text-gray-500">
                  * Some token counts are estimated.
                </p>
              ) : null}
            </div>
          )}
        </GlassCardUI>
      </section>
    </div>
  );
}

const KEY_SOURCE_LABELS: Record<OrgPlanView["usage"][number]["key_source"], string> = {
  user: "Your key",
  org: "Organization key",
  env: "Included",
};
