// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

const meta = { title: "Shared UI / Motion" };
export default meta;

/**
 * The shared motion vocabulary. Easings live under Tailwind's `--ease-*`
 * namespace, so `ease-out-strong`, `ease-out-soft` and `ease-in-out-soft`
 * compile as timing-function utilities; durations are `--motion-duration-*`
 * custom properties used as `duration-(--motion-duration-fast)`.
 *
 * "Move the markers" runs each curve over the slowest duration so the three
 * shapes can be compared, and the button is itself a pressable: hold it to
 * see the press. Under reduced motion the markers jump and the press dims
 * instead of scaling. See "Motion" in docs/design-system.md.
 */
const EASINGS: [name: string, value: string, use: string][] = [
    [
        "ease-out-strong",
        "cubic-bezier(0.16, 1, 0.3, 1)",
        "Entrances and exits: a quick settle",
    ],
    [
        "ease-out-soft",
        "cubic-bezier(0.33, 1, 0.68, 1)",
        "Presses and small moves",
    ],
    [
        "ease-in-out-soft",
        "cubic-bezier(0.65, 0, 0.35, 1)",
        "Moves that leave and arrive: sidebar width, title slide",
    ],
];

const DURATIONS: [token: string, value: string, use: string][] = [
    [
        "--motion-duration-instant",
        "80ms",
        "The press of a pill, tab, send or icon button",
    ],
    ["--motion-duration-fast", "120ms", "Exits; chevrons and small fades"],
    [
        "--motion-duration-base",
        "180ms",
        "Entrances: menus, popovers, toasts",
    ],
    [
        "--motion-duration-slow",
        "300ms",
        "The sidebar's width, and the ceiling",
    ],
];

/**
 * One curve. The runner spans the track less the marker's width, so moving it
 * by its own width (`translate-x-full`) carries the marker from one end of the
 * track to the other. A percentage on the marker itself would be a percentage
 * of the marker, and it would not move.
 */
function EasingTrack({ easing, moved }: { easing: string; moved: boolean }) {
    return (
        <div className="relative h-6 overflow-hidden rounded-full border border-border-strong bg-surface">
            <div
                className={`absolute inset-y-0 left-0 right-6 transition-transform duration-(--motion-duration-slow) motion-reduce:transition-none ${easing} ${moved ? "translate-x-full" : "translate-x-0"}`}
            >
                <div className="h-full w-6 rounded-full bg-brand-primary" />
            </div>
        </div>
    );
}

function MotionReference() {
    const [moved, setMoved] = useState(false);
    return (
        <div className="min-w-80 space-y-6 rounded-2xl bg-app-background p-6 text-fg">
            <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Easing</h3>
                    <PillButtonUI
                        tone="white"
                        size="xs"
                        onClick={() => setMoved((value) => !value)}
                    >
                        {moved ? "Return the markers" : "Move the markers"}
                    </PillButtonUI>
                </div>
                {EASINGS.map(([name, value, use]) => (
                    <div key={name} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                            <code className="font-mono">{name}</code>
                            <span className="text-fg-muted">{use}</span>
                        </div>
                        <EasingTrack easing={name} moved={moved} />
                        <code className="block font-mono text-[11px] text-fg-muted">
                            {value}
                        </code>
                    </div>
                ))}
            </section>

            <section className="space-y-2">
                <h3 className="text-sm font-semibold">Duration</h3>
                <ul className="space-y-1.5">
                    {DURATIONS.map(([token, value, use]) => (
                        <li
                            key={token}
                            className="flex items-baseline justify-between gap-3 text-xs"
                        >
                            <code className="font-mono">{token}</code>
                            <span className="font-mono tabular-nums">{value}</span>
                            <span className="flex-1 text-right text-fg-muted">
                                {use}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

/** Light and dark side by side; the Ladle theme toggle flips the page too. */
export const Tokens = () => (
    <div className="flex flex-wrap gap-4">
        <MotionReference />
        <div className="dark">
            <MotionReference />
        </div>
    </div>
);
