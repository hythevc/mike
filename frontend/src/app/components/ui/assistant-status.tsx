// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { CSSProperties } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { BrandMarkTint } from "@/shared/ui/BrandMarkUI";
import { cn } from "@/app/lib/utils";

/**
 * The assistant's live status, shown as a small neutral indicator rather than
 * the product mark: a mark identifies the product, this reports what the
 * assistant is doing. Colour never carries the meaning alone — "done" and
 * "error" also draw a glyph, and callers that need the state announced pass a
 * `label`.
 *
 *   idle     resting, waiting to start or paused for the user
 *   working  a turn is in progress
 *   done     the turn delivered a response
 *   error    the turn failed
 *
 * A `tint` tells several indicators apart, such as subagents working side by
 * side; it is ignored for the done and error states, which keep their own
 * colour.
 */
export type AssistantStatusState = "idle" | "working" | "done" | "error";

const TINT_COLOR: Record<BrandMarkTint, string> = {
    sky: "#0284c7",
    violet: "#7c3aed",
    amber: "#b45309",
    pink: "#be185d",
    teal: "#0f766e",
    indigo: "#4338ca",
};

export function AssistantStatus({
    state = "idle",
    tint,
    size = 22,
    className,
    style,
    label,
}: {
    state?: AssistantStatusState;
    tint?: BrandMarkTint;
    size?: number;
    className?: string;
    style?: CSSProperties;
    /** An accessible name. When omitted the indicator is decorative. */
    label?: string;
}) {
    const accent = tint ? TINT_COLOR[tint] : "var(--brand-primary, #1f3a5f)";
    const glyphSize = Math.round(size * 0.6);

    const a11y = label
        ? { role: "img" as const, "aria-label": label }
        : { "aria-hidden": true };

    return (
        <span
            data-slot="assistant-status"
            data-state={state}
            className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
            style={{ width: size, height: size, ...style }}
            {...a11y}
        >
            {state === "working" ? (
                // A ring with one quarter left open, turning while the
                // assistant works. The global reduced-motion rule stops the
                // spin for people who ask for less motion.
                <span
                    className="block animate-spin rounded-full"
                    style={{
                        width: size,
                        height: size,
                        borderWidth: Math.max(2, Math.round(size / 11)),
                        borderStyle: "solid",
                        borderColor: accent,
                        borderTopColor: "transparent",
                    }}
                />
            ) : state === "done" ? (
                <span
                    className="flex items-center justify-center rounded-full"
                    style={{ width: size, height: size, backgroundColor: "#15803d" }}
                >
                    <Check size={glyphSize} color="#ffffff" strokeWidth={3} />
                </span>
            ) : state === "error" ? (
                <span
                    className="flex items-center justify-center rounded-full"
                    style={{ width: size, height: size, backgroundColor: "#b91c1c" }}
                >
                    <TriangleAlert size={glyphSize} color="#ffffff" strokeWidth={2.5} />
                </span>
            ) : (
                // Idle: a filled disc with a soft ring, the assistant present
                // but not working.
                <span
                    className="block rounded-full"
                    style={{
                        width: Math.round(size * 0.6),
                        height: Math.round(size * 0.6),
                        backgroundColor: accent,
                        boxShadow: `0 0 0 ${Math.max(1, Math.round(size / 11))}px color-mix(in srgb, ${
                            tint ? TINT_COLOR[tint] : "var(--brand-primary, #1f3a5f)"
                        } 22%, transparent)`,
                    }}
                />
            )}
        </span>
    );
}
