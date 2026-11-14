// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export type HeadingUISize =
    | "settings"
    | "display"
    | "page"
    | "section"
    | "label";

/**
 * The display type scale, largest to smallest. One place for the heading
 * recipes that were otherwise hand-written across the settings areas, page
 * headers and empty states, so hierarchy reads the same on every screen.
 *
 * - `settings`: a settings-area title (the largest display heading).
 * - `display`: empty-state and other display headings (~2.5x body).
 * - `page`: a page title; one step below `display` because it sits beside the
 *   header's controls. `PAGE_HEADER_TITLE_CLASS` is this entry.
 * - `section`: a section heading inside a page or settings area.
 * - `label`: a small group or field label.
 *
 * The serif face (EB Garamond, via `font-serif`) carries the display sizes;
 * sections and labels stay in the sans chrome face.
 */
export const HEADING_SIZE_CLASSES: Record<HeadingUISize, string> = {
    settings: "font-serif text-3xl font-medium",
    display: "font-serif text-2xl font-medium",
    page: "font-serif text-xl font-medium",
    section: "font-sans text-xl font-medium",
    label: "font-sans text-sm font-medium",
};

const DEFAULT_LEVEL: Record<HeadingUISize, ElementType> = {
    settings: "h1",
    display: "h2",
    page: "h1",
    section: "h2",
    label: "h3",
};

export interface HeadingUIProps {
    children: ReactNode;
    /** The display size from the documented type scale. */
    size?: HeadingUISize;
    /**
     * The semantic element. Defaults to a sensible level for the size; pass it
     * to keep the document's heading order right, or `"p"`/`"span"` where the
     * display style is wanted without a heading in the outline (an empty state
     * inside a table, for example).
     */
    as?: ElementType;
    /** `danger` for a destructive section heading; otherwise the `text-fg` role. */
    tone?: "default" | "danger";
    id?: string;
    className?: string;
}

/**
 * A heading rendered at one of the documented display sizes, in the `text-fg`
 * colour role (never a raw gray). Cross-target: rendered by both the web app
 * and the Word add-in, so it must not import anything from `frontend/src/app/`.
 */
export function HeadingUI({
    children,
    size = "section",
    as,
    tone = "default",
    id,
    className,
}: HeadingUIProps) {
    const Component = as ?? DEFAULT_LEVEL[size];
    return (
        <Component
            id={id}
            className={twMerge(
                clsx(
                    HEADING_SIZE_CLASSES[size],
                    tone === "danger" ? "text-danger" : "text-fg",
                    className,
                ),
            )}
        >
            {children}
        </Component>
    );
}
