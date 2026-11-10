"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/app/lib/utils";
import { LIQUID_GLASS_FLOAT_CLASS } from "@/shared/ui/LiquidGlassUI";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Enter and exit for the popover surface, matching the menu's: a fade, at most
 * 2px of travel out of the trigger origin and a 0.98 scale, with the exit a
 * tier quicker than the enter. Radix mounts and unmounts the surface, so this
 * is a tw-animate keyframe pair. Under reduced motion the scale is dropped here
 * and the translate in MotionUI.css, leaving the fade. The timing uses
 * `animation-duration-*` for the reason given on the menu's constant in
 * shared/ui/dropdown.tsx: `duration-*` would also start transitions here.
 */
export const POPOVER_CONTENT_MOTION_CLASS =
    "origin-(--radix-popover-content-transform-origin) " +
    "data-[state=open]:animate-in data-[state=closed]:animate-out " +
    "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 " +
    "data-[state=open]:zoom-in-[0.98] data-[state=closed]:zoom-out-[0.98] " +
    "data-[side=bottom]:slide-in-from-top-[2px] data-[side=left]:slide-in-from-right-[2px] " +
    "data-[side=right]:slide-in-from-left-[2px] data-[side=top]:slide-in-from-bottom-[2px] " +
    "data-[state=open]:animation-duration-(--motion-duration-enter) data-[state=closed]:animation-duration-(--motion-duration-exit) " +
    "data-[state=open]:ease-out-strong data-[state=closed]:ease-out-strong " +
    "motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100";

export function PopoverContent({
    className,
    align = "center",
    sideOffset = 4,
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                data-slot="popover-content"
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    `z-[250] rounded-xl p-3 text-gray-700 outline-none ${LIQUID_GLASS_FLOAT_CLASS}`,
                    POPOVER_CONTENT_MOTION_CLASS,
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
}
