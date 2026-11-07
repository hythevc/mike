import { X } from "lucide-react";
import { PillButtonUI } from "./PillButtonUI";

export type CloseButtonSize = "sm" | "md";

const sizeClasses: Record<CloseButtonSize, { button: string; icon: string }> = {
    /** Side panels. */
    sm: { button: "h-4 w-4", icon: "h-2.5 w-2.5" },
    /** Modals. */
    md: { button: "h-5 w-5", icon: "h-3 w-3" },
};

/**
 * A centred 24x24 pseudo-element so the pointer and keyboard target meets WCAG
 * 2.5.8 (24x24 CSS px) while the ✕ glyph stays the small size above. The glass
 * surfaces never clip overflow, so the invisible target extends past the glyph.
 */
const HIT_AREA_CLASS =
    "relative before:absolute before:left-1/2 before:top-1/2 before:size-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

/** The small white ✕ that dismisses a side panel, modal or other surface. */
export function CloseButton({
    onClick,
    label = "Close",
    size = "sm",
    className,
}: {
    onClick: () => void;
    label?: string;
    size?: CloseButtonSize;
    className?: string;
}) {
    const classes = sizeClasses[size];
    return (
        <PillButtonUI
            tone="white"
            size="icon-xs"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`${classes.button} ${HIT_AREA_CLASS} shrink-0 ${className ?? ""}`}
        >
            <X aria-hidden="true" className={classes.icon} />
        </PillButtonUI>
    );
}
