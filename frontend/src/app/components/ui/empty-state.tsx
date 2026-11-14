"use client";

import type { ReactNode } from "react";
import { cn } from "@/app/lib/utils";
import { HeadingUI } from "@/shared/ui/HeadingUI";

type EmptyStateProps = {
    /** Rendered at 32px; pass the bare icon, the wrapper sizes it. */
    icon?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    /** Usually a `PillButtonUI`. */
    action?: ReactNode;
    tone?: "default" | "error";
    className?: string;
};

/**
 * The standard "nothing here yet" block: icon, serif display heading, muted
 * body copy and an optional call to action. Drop it inside `TableEmptyState`
 * for tables, or use it standalone for panels.
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    tone = "default",
    className,
}: EmptyStateProps) {
    return (
        <div
            data-slot="empty-state"
            className={cn("flex flex-col items-start text-left", className)}
        >
            {icon ? (
                <span
                    data-slot="empty-state-icon"
                    aria-hidden="true"
                    className="mb-4 inline-flex [&>*]:h-8 [&>*]:w-8"
                >
                    {icon}
                </span>
            ) : null}
            <HeadingUI as="p" size="display">
                {title}
            </HeadingUI>
            {description ? (
                <p
                    data-slot="empty-state-description"
                    className={cn(
                        "mt-1 max-w-xs text-xs",
                        tone === "error" ? "text-danger" : "text-fg-muted",
                    )}
                >
                    {description}
                </p>
            ) : null}
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}
