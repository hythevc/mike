// SPDX-License-Identifier: AGPL-3.0-only
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Tooltip, TooltipProvider } from "@/app/components/ui/tooltip";

const meta = { title: "UI / Tooltip" };
export default meta;

const iconButton =
    "inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-subtle liquid-glass-subtle liquid-glass-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]";

export const Tooltips = () => (
    <TooltipProvider>
        <div className="flex max-w-md flex-col items-start gap-8 p-12 text-sm text-fg">
            <Tooltip content="Row actions">
                <button type="button" aria-label="Row actions" className={iconButton}>
                    <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                </button>
            </Tooltip>

            <Tooltip content="This passage was found on the cited page.">
                <span tabIndex={0} className="text-success underline decoration-dotted">
                    Quote found
                </span>
            </Tooltip>

            <Tooltip content="You cannot delete a shared review.">
                <button type="button" disabled aria-label="Delete" className={iconButton}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
            </Tooltip>

            <p className="text-xs text-fg-muted">
                A tooltip supplements an accessible name; it never replaces one
                and never holds anything to click. Hover opens it after a short
                delay, keyboard focus opens it at once, and a disabled control is
                wrapped so its tooltip still shows.
            </p>
        </div>
    </TooltipProvider>
);
