// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import { cn } from "@/app/lib/utils";
import { LIQUID_GLASS_SUBTLE_CLASS } from "@/shared/ui/LiquidGlassUI";

/**
 * A keyboard key or chord rendered in a `<kbd>`.
 *
 * It is platform-aware: the `mod` token shows ⌘ on Apple platforms and Ctrl
 * everywhere else, so a shortcut reads the way the person's own keyboard
 * labels it. The parts of a chord are joined with non-breaking spaces so a
 * shortcut never wraps mid-combination. Text sits at the 11px floor with
 * tabular figures, matching the badge size in the type scale.
 */

export type KbdToken = "mod" | "shift" | "alt" | "enter" | "escape" | string;

const NBSP = " ";

// The platform never changes within a session, so the store has nothing to
// subscribe to; the server and the first client paint both render the
// non-Apple labels, and useSyncExternalStore swaps in the real value after
// hydration without a warning.
const noopSubscribe = () => () => {};

function readIsApplePlatform(): boolean {
    if (typeof navigator === "undefined") return false;
    const uaData = (
        navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData;
    const source = uaData?.platform || navigator.platform || navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(source ?? "");
}

function serverIsApplePlatform(): boolean {
    return false;
}

/** Whether the current device uses the Apple modifier glyphs (⌘, ⌥, ⇧). */
export function useIsApplePlatform(): boolean {
    return React.useSyncExternalStore(
        noopSubscribe,
        readIsApplePlatform,
        serverIsApplePlatform,
    );
}

function tokenLabel(token: KbdToken, apple: boolean): string {
    switch (token) {
        case "mod":
            return apple ? "⌘" : "Ctrl";
        case "shift":
            return apple ? "⇧" : "Shift";
        case "alt":
            return apple ? "⌥" : "Alt";
        case "enter":
            return apple ? "↵" : "Enter";
        case "escape":
            return "Esc";
        default:
            return token;
    }
}

export const KBD_CLASS =
    `inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none text-fg-subtle [font-variant-numeric:tabular-nums] ${LIQUID_GLASS_SUBTLE_CLASS}`;

export interface KbdProps
    extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
    /** The key or chord, newest-to-oldest left to right, e.g. ["mod", "K"]. */
    keys: KbdToken[];
}

export function Kbd({ keys, className, ...props }: KbdProps): React.ReactElement {
    const apple = useIsApplePlatform();
    const text = keys.map((token) => tokenLabel(token, apple)).join(NBSP);
    return (
        <kbd data-slot="kbd" className={cn(KBD_CLASS, className)} {...props}>
            {text}
        </kbd>
    );
}
