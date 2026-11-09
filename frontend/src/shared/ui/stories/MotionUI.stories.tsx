const meta = { title: "Shared UI / Motion" };
export default meta;

/**
 * The shared motion vocabulary (W26). Easings live under Tailwind's `--ease-*`
 * namespace, so `ease-out-strong`, `ease-out-soft` and `ease-in-out-soft`
 * compile as timing-function utilities; durations are `--motion-duration-*`
 * custom properties used as `duration-(--motion-duration-fast)`. Hover a track
 * to watch its curve; everything animates transform and opacity only, and
 * respects reduced motion. See docs/design-system.md → Motion.
 */
const EASINGS: [name: string, value: string, use: string][] = [
    ["ease-out-strong", "cubic-bezier(0.16, 1, 0.3, 1)", "Entrances — a quick settle"],
    ["ease-out-soft", "cubic-bezier(0.33, 1, 0.68, 1)", "Presses and small moves"],
    [
        "ease-in-out-soft",
        "cubic-bezier(0.65, 0, 0.35, 1)",
        "Symmetric moves: sidebar width, long-title slide",
    ],
];

const DURATIONS: [token: string, value: string, use: string][] = [
    ["--motion-duration-instant", "80ms", "Frequent, direct feedback"],
    ["--motion-duration-fast", "120ms", "Presses; the default exit"],
    ["--motion-duration-base", "180ms", "The default entrance"],
    ["--motion-duration-slow", "300ms", "Sidebar width; nothing is slower"],
];

function EasingTrack({ easing }: { easing: string }) {
    return (
        <div className="group h-6 w-full overflow-hidden rounded-full border border-border-strong bg-surface">
            <div
                className={`h-full w-6 rounded-full bg-brand-primary transition-transform duration-(--motion-duration-slow) group-hover:translate-x-[calc(100%-1.5rem)] motion-reduce:transition-none ${easing}`}
            />
        </div>
    );
}

function MotionReference() {
    return (
        <div className="min-w-80 space-y-6 rounded-2xl bg-app-background p-6 text-fg">
            <section className="space-y-3">
                <h3 className="text-sm font-semibold">Easing</h3>
                {EASINGS.map(([name, value, use]) => (
                    <div key={name} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                            <code className="font-mono">{name}</code>
                            <span className="text-fg-muted">{use}</span>
                        </div>
                        <EasingTrack easing={name} />
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
