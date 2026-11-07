import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
    LIQUID_GLASS_FLAT_CLASS,
    LIQUID_GLASS_HOVER_CLASS,
} from "./LiquidGlassUI";

export type PillButtonUITone = "black" | "white" | "blue" | "danger";
export type PillButtonUISize = "xs" | "icon-xs" | "sm" | "normal";

const toneClasses: Record<PillButtonUITone, string> = {
    black: "bg-gray-950/88 text-white shadow-[0_3px_9px_rgba(15,23,42,0.10),inset_1px_1px_0_rgba(255,255,255,0.22),inset_-1px_-1px_0_rgba(255,255,255,0.10),inset_-4px_-4px_9px_rgba(15,23,42,0.2)] hover:bg-gray-900/90 disabled:hover:bg-gray-950/88",
    white: `${LIQUID_GLASS_FLAT_CLASS} ${LIQUID_GLASS_HOVER_CLASS} text-gray-700`,
    // Brand primary, not the legacy azure: white on #0088ff was ~3.3:1. The
    // --brand-primary token (DesignTokensUI.css, fed by the brand config with a
    // darkened azure fallback) carries on-brand text at >= 4.5:1; hover darkens
    // it so the ratio only rises.
    blue: "bg-brand-primary text-brand-on-primary shadow-[0_3px_9px_rgba(37,99,235,0.10),inset_1px_1px_0_rgba(255,255,255,0.28),inset_-1px_-1px_0_rgba(255,255,255,0.14),inset_-4px_-4px_9px_rgba(29,78,216,0.2)] hover:brightness-95 disabled:hover:brightness-100",
    danger: "bg-red-600/90 text-white shadow-[0_3px_9px_rgba(127,29,29,0.10),inset_1px_1px_0_rgba(255,255,255,0.22),inset_-1px_-1px_0_rgba(255,255,255,0.12),inset_-4px_-4px_9px_rgba(127,29,29,0.18)] hover:bg-red-600 disabled:hover:bg-red-600/90",
};

const sizeClasses: Record<PillButtonUISize, string> = {
    xs: "h-6 px-2.5 text-[11px] leading-none has-[svg]:pl-1.5 has-[img]:pl-1.5",
    "icon-xs": "h-6 w-6 p-0 text-[11px] leading-none",
    sm: "h-7 px-3 text-xs leading-none has-[svg]:pl-2 has-[img]:pl-2",
    normal: "h-8 px-4 text-sm leading-none has-[svg]:pl-3 has-[img]:pl-3",
};

/**
 * `transition`, not `transition-all`: `all` includes `visibility`, which is
 * inherited. The assistant side panel keeps inactive tabs mounted and hides
 * them with `invisible`, so a pill inside one animated that inherited change
 * and stayed on screen for the transition's full duration after the user
 * switched tabs. Tailwind's default property list covers every visual property
 * these tones declare — color, background, border, box-shadow, opacity,
 * transform/scale, filter — and leaves visibility alone.
 */
export function pillButtonUIClassName({
    tone,
    size = "sm",
    className,
}: {
    tone: PillButtonUITone;
    size?: PillButtonUISize;
    className?: string;
}) {
    return twMerge(
        clsx(
            "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
            toneClasses[tone],
            sizeClasses[size],
            className,
        ),
    );
}
