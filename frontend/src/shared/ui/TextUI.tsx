// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export type TextUIVariant = "body" | "chrome" | "subtle" | "muted" | "badge";

/**
 * Secondary-text recipes, pairing a size with a colour role. One place for the
 * body, chrome, label and description text that was otherwise written as raw
 * `text-sm text-gray-*` recipes across the app.
 *
 * - `body`: 14px primary text, the readable default for prose and rows.
 * - `chrome`: 13px primary text, the dense chrome base.
 * - `subtle`: 14px secondary text (a field label, a quiet heading companion).
 * - `muted`: 14px muted text (a field description, a caption).
 * - `badge`: 11px muted text, the floor; for a badge or a superscript marker.
 *
 * Colours are the `text-fg` family, never a raw gray; nothing drops below 11px.
 */
export const TEXT_VARIANT_CLASSES: Record<TextUIVariant, string> = {
    body: "text-sm text-fg",
    chrome: "text-xs text-fg",
    subtle: "text-sm text-fg-subtle",
    muted: "text-sm text-fg-muted",
    badge: "text-[11px] text-fg-muted",
};

export interface TextUIProps {
    children: ReactNode;
    /** The size-and-colour recipe from the documented scale. */
    variant?: TextUIVariant;
    /** The element; defaults to `<p>`. Pass `"span"` for inline text. */
    as?: ElementType;
    /** `medium` for a label line; otherwise the regular 400 weight. */
    weight?: "normal" | "medium";
    /** Overrides the variant's colour for a status line. */
    tone?: "default" | "danger" | "success" | "warning";
    id?: string;
    title?: string;
    className?: string;
}

const TONE_CLASS: Record<NonNullable<TextUIProps["tone"]>, string | null> = {
    default: null,
    danger: "text-danger",
    success: "text-success",
    warning: "text-warning",
};

/**
 * Body, chrome and label text at a documented size and colour role.
 * Cross-target: rendered by both the web app and the Word add-in, so it must
 * not import anything from `frontend/src/app/`.
 */
export function TextUI({
    children,
    variant = "body",
    as,
    weight = "normal",
    tone = "default",
    id,
    title,
    className,
}: TextUIProps) {
    const Component = as ?? "p";
    return (
        <Component
            id={id}
            title={title}
            className={twMerge(
                clsx(
                    TEXT_VARIANT_CLASSES[variant],
                    weight === "medium" && "font-medium",
                    TONE_CLASS[tone],
                    className,
                ),
            )}
        >
            {children}
        </Component>
    );
}
