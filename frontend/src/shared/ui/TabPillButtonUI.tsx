"use client";

import type { ComponentProps, ReactElement } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
    LIQUID_GLASS_FLAT_CLASS,
    LIQUID_GLASS_HOVER_CLASS,
    LIQUID_GLASS_SUBTLE_CLASS,
} from "./LiquidGlassUI";

export type TabPillButtonUIProps = ComponentProps<"button"> & {
    active?: boolean;
    /** "flat" suits tabs inside a flat panel; the active tab shows by its text. */
    surface?: "subtle" | "flat";
};

/** Canonical tab-style pill shared by the web app and Word add-in. */
export function TabPillButtonUI({
    active,
    surface = "subtle",
    type = "button",
    className,
    ...props
}: TabPillButtonUIProps): ReactElement {
    const flat = surface === "flat";
    const stateClass =
        active === true
            ? flat
                ? "text-gray-900"
                : // A semantic selected fill, not bg-white: in the dark theme
                  // bg-white mapped to the same value as the subtle material,
                  // so the active tab had no fill of its own. bg-app-surface-
                  // active differs from the material in both themes.
                  "bg-app-surface-active text-gray-900"
            : `${LIQUID_GLASS_HOVER_CLASS} text-gray-500 hover:text-gray-900`;

    return (
        <button
            data-slot="tab-pill-button"
            type={type}
            aria-pressed={active}
            className={twMerge(
                clsx(
                    `inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium ${flat ? LIQUID_GLASS_FLAT_CLASS : LIQUID_GLASS_SUBTLE_CLASS} transition-[transform,opacity] duration-(--motion-duration-fast) ease-out-soft active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-solid focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-40 disabled:active:scale-100`,
                    stateClass,
                    className,
                ),
            )}
            {...props}
        />
    );
}
