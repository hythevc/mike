// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverAnchor, POPOVER_CONTENT_MOTION_CLASS } from "./popover";
import { cn } from "@/app/lib/utils";
import { LIQUID_GLASS_FLOAT_CLASS } from "@/shared/ui/LiquidGlassUI";

/**
 * A tooltip: a short description that supplements a control's accessible name.
 *
 * It is a controlled Radix popover anchored to its trigger, with the content
 * marked `role="tooltip"` and referenced from the trigger's `aria-describedby`.
 * It opens on hover after a short delay and on keyboard focus with none, and
 * closes on pointer leave, blur, Escape and a press. A touch-only pointer
 * opens nothing — a tap is the control's action, not a request for help.
 *
 * It never replaces an accessible name and never carries interactive content:
 * the surface is `pointer-events-none`, so there is nothing to click inside
 * it. A disabled control fires no pointer or focus events, so the primitive
 * wraps one in a focusable span and anchors to that instead.
 *
 * Motion reuses the popover's enter/exit (a fade and at most 2px of travel out
 * of the trigger origin on W26's tokens, a fade under reduced motion).
 */

const DEFAULT_DELAY_MS = 500;
// Moving between neighbouring tooltips within this window opens the next one at
// once, so a row of icon buttons does not re-wait the full delay each time.
const DEFAULT_SKIP_DELAY_MS = 300;

interface TooltipConfig {
    delayMs: number;
    shouldSkipDelay: () => boolean;
    markClosed: () => void;
}

const TooltipContext = React.createContext<TooltipConfig | null>(null);

/**
 * Shares the hover delay and a short "skip the delay" window across the
 * tooltips beneath it. Mount one near the app root. A tooltip works without a
 * provider, using the default timings.
 */
export function TooltipProvider({
    children,
    delayMs = DEFAULT_DELAY_MS,
    skipDelayMs = DEFAULT_SKIP_DELAY_MS,
}: {
    children: React.ReactNode;
    delayMs?: number;
    skipDelayMs?: number;
}): React.ReactElement {
    const lastClosedAt = React.useRef(0);
    const value = React.useMemo<TooltipConfig>(
        () => ({
            delayMs,
            shouldSkipDelay: () => Date.now() - lastClosedAt.current < skipDelayMs,
            markClosed: () => {
                lastClosedAt.current = Date.now();
            },
        }),
        [delayMs, skipDelayMs],
    );
    return (
        <TooltipContext.Provider value={value}>
            {children}
        </TooltipContext.Provider>
    );
}

export interface TooltipProps {
    /** The description. Plain text or inline nodes only; nothing interactive. */
    content: React.ReactNode;
    /** The control the tooltip describes: exactly one focusable element. */
    children: React.ReactElement;
    side?: React.ComponentProps<typeof PopoverPrimitive.Content>["side"];
    align?: React.ComponentProps<typeof PopoverPrimitive.Content>["align"];
    sideOffset?: number;
    /** Overrides the hover delay for this tooltip. */
    delayMs?: number;
    className?: string;
}

export function Tooltip({
    content,
    children,
    side = "top",
    align = "center",
    sideOffset = 6,
    delayMs,
    className,
}: TooltipProps): React.ReactElement {
    const config = React.useContext(TooltipContext);
    const delay = delayMs ?? config?.delayMs ?? DEFAULT_DELAY_MS;
    const [open, setOpen] = React.useState(false);
    // The trigger node, captured by a ref callback so the open/close listeners
    // can live in an effect — where reading the timer and touch refs is safe —
    // rather than in props handed back through render.
    const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
    const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    // A tap focuses the control; that focus must not open a tooltip the person
    // cannot dismiss by moving a pointer away.
    const lastPointerWasTouch = React.useRef(false);
    const tooltipId = React.useId();

    const clearTimer = React.useCallback(() => {
        if (openTimer.current) {
            clearTimeout(openTimer.current);
            openTimer.current = null;
        }
    }, []);

    const hide = React.useCallback(() => {
        clearTimer();
        setOpen((wasOpen) => {
            if (wasOpen) config?.markClosed();
            return false;
        });
    }, [clearTimer, config]);

    const showNow = React.useCallback(() => {
        clearTimer();
        setOpen(true);
    }, [clearTimer]);

    const showAfterDelay = React.useCallback(() => {
        clearTimer();
        if (config?.shouldSkipDelay()) {
            setOpen(true);
            return;
        }
        openTimer.current = setTimeout(() => setOpen(true), delay);
    }, [clearTimer, config, delay]);

    // Open and close from native listeners on the trigger. Hover opens after
    // the delay (never from a touch pointer), focus opens at once (unless a
    // tap caused that focus), and pointer leave, blur, a press and Escape all
    // close it.
    React.useEffect(() => {
        if (!anchorEl) return () => clearTimer();
        const onPointerEnter = (event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            showAfterDelay();
        };
        const onPointerLeave = () => hide();
        const onPointerDown = (event: PointerEvent) => {
            lastPointerWasTouch.current = event.pointerType === "touch";
            hide();
        };
        const onFocus = () => {
            if (lastPointerWasTouch.current) {
                lastPointerWasTouch.current = false;
                return;
            }
            showNow();
        };
        const onBlur = () => hide();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") hide();
        };
        anchorEl.addEventListener("pointerenter", onPointerEnter);
        anchorEl.addEventListener("pointerleave", onPointerLeave);
        anchorEl.addEventListener("pointerdown", onPointerDown);
        anchorEl.addEventListener("focus", onFocus);
        anchorEl.addEventListener("blur", onBlur);
        anchorEl.addEventListener("keydown", onKeyDown);
        return () => {
            clearTimer();
            anchorEl.removeEventListener("pointerenter", onPointerEnter);
            anchorEl.removeEventListener("pointerleave", onPointerLeave);
            anchorEl.removeEventListener("pointerdown", onPointerDown);
            anchorEl.removeEventListener("focus", onFocus);
            anchorEl.removeEventListener("blur", onBlur);
            anchorEl.removeEventListener("keydown", onKeyDown);
        };
    }, [anchorEl, clearTimer, hide, showNow, showAfterDelay]);

    const child = React.Children.only(children) as React.ReactElement<
        Record<string, unknown>
    >;
    const isDisabled = child.props.disabled === true;

    const describedBy =
        [
            child.props["aria-describedby"] as string | undefined,
            open ? tooltipId : null,
        ]
            .filter(Boolean)
            .join(" ") || undefined;

    // Only a ref (to capture the node) and a description id reach the trigger
    // through render; the behaviour is wired on the node in the effect above.
    const anchor = isDisabled ? (
        // A disabled control receives no events, so a focusable span carries
        // them and anchors the tooltip; the control stays visible inside it.
        <span ref={setAnchorEl} tabIndex={0} aria-describedby={describedBy}>
            {child}
        </span>
    ) : (
        React.cloneElement(child, {
            ref: setAnchorEl,
            "aria-describedby": describedBy,
        })
    );

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (!next) hide();
            }}
        >
            <PopoverAnchor asChild>{anchor}</PopoverAnchor>
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    role="tooltip"
                    id={tooltipId}
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    // Keep focus on the trigger: a tooltip is described, not
                    // entered.
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    className={cn(
                        "pointer-events-none z-[250] max-w-[16rem] rounded-lg px-2.5 py-1.5 text-xs text-fg",
                        LIQUID_GLASS_FLOAT_CLASS,
                        POPOVER_CONTENT_MOTION_CLASS,
                        className,
                    )}
                >
                    {content}
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </Popover>
    );
}
