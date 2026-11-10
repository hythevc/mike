// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Search } from "lucide-react";
import { Kbd } from "@/app/components/ui/kbd";
import { useCommandMenu } from "@/app/components/shared/CommandMenu";
import { COMMAND_MENU_LABELS } from "@/app/components/shared/helpMenuLabels";
import {
    LIQUID_GLASS_HOVER_CLASS,
    LIQUID_GLASS_SUBTLE_CLASS,
} from "@/shared/ui/LiquidGlassUI";
import { cn } from "@/app/lib/utils";

/**
 * The sidebar's visible way into the command menu: a search-shaped button that
 * shows the shortcut. Collapsed, it falls back to an icon button. Opening the
 * menu from here records this button as the element focus returns to on close.
 */
export function CommandMenuTrigger({
    isOpen,
}: {
    isOpen: boolean;
}): React.ReactElement {
    const { openCommandMenu } = useCommandMenu();

    if (!isOpen) {
        return (
            <button
                type="button"
                onClick={openCommandMenu}
                aria-label={COMMAND_MENU_LABELS.title}
                className={cn(
                    "mx-1.5 hidden h-8 w-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:text-fg md:flex",
                    LIQUID_GLASS_HOVER_CLASS,
                )}
            >
                <Search aria-hidden="true" className="h-4 w-4" />
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={openCommandMenu}
            className={cn(
                "mx-1.5 flex h-8 items-center gap-2 rounded-md px-2 text-fg-subtle transition-colors hover:text-fg",
                LIQUID_GLASS_SUBTLE_CLASS,
                LIQUID_GLASS_HOVER_CLASS,
            )}
        >
            <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left text-xs">
                {COMMAND_MENU_LABELS.triggerLabel}
            </span>
            <Kbd keys={["mod", "K"]} />
        </button>
    );
}
