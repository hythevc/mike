// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { RequestDeskForm } from "@/app/lib/mikeApi";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { personName } from "./intakeLabels";
import { formStatusLabel, senderDomainsLabel } from "./requestFormLabels";

function dateText(iso: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export interface RequestFormCardProps {
    form: RequestDeskForm;
    /** Which action, if any, is in flight for this form. */
    busy: "rotate" | "toggle" | null;
    onEdit: () => void;
    onReplaceLink: () => void;
    onToggleEnabled: () => void;
}

/** One request form: its settings as plain text, and the actions on it. */
export function RequestFormCard({
    form,
    busy,
    onEdit,
    onReplaceLink,
    onToggleEnabled,
}: RequestFormCardProps) {
    const facts: [string, string][] = [
        ["Status", formStatusLabel(form)],
        ["Accepts requests from", senderDomainsLabel(form.allowed_sender_domains)],
        ["Kept for", `${form.retention_days} days unless taken on as a matter`],
        [
            "Created",
            `${dateText(form.created_at)}${form.created_by ? ` by ${personName(form.created_by)}` : ""}`,
        ],
        ...(form.token_rotated_at
            ? ([["Link replaced", dateText(form.token_rotated_at)]] as [string, string][])
            : []),
    ];
    return (
        <GlassCardUI>
            <article aria-labelledby={`form-${form.id}-title`} className="space-y-4 p-4">
                <div className="min-w-0">
                    <h2
                        id={`form-${form.id}-title`}
                        className="text-base font-medium text-fg [overflow-wrap:anywhere]"
                    >
                        {form.title}
                    </h2>
                    {form.intro ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-fg-subtle">{form.intro}</p>
                    ) : null}
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                    {facts.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-fg-muted">{label}</dt>
                            <dd className="text-fg [overflow-wrap:anywhere]">{value}</dd>
                        </div>
                    ))}
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                    <PillButtonUI tone="white" size="sm" onClick={onEdit} disabled={busy !== null}>
                        Edit
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        onClick={onReplaceLink}
                        loading={busy === "rotate"}
                        disabled={busy !== null}
                    >
                        Replace link
                    </PillButtonUI>
                    <PillButtonUI
                        tone="white"
                        size="sm"
                        onClick={onToggleEnabled}
                        loading={busy === "toggle"}
                        disabled={busy !== null}
                    >
                        {form.enabled ? "Switch off" : "Switch on"}
                    </PillButtonUI>
                </div>
            </article>
        </GlassCardUI>
    );
}
