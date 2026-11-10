// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
    CircleAlert,
    CircleCheck,
    CircleDashed,
    CircleMinus,
    FileX,
    History,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { Tooltip } from "@/app/components/ui/tooltip";
import {
    QUOTE_MARKER_DESCRIPTIONS,
    QUOTE_MARKER_LABELS,
    type QuoteMarkerKind,
} from "./tabularQuoteLabels";

/**
 * The icon paired with each marker. The icon always sits beside the text, so
 * the status is never carried by colour alone.
 */
const MARKER_ICON: Record<QuoteMarkerKind, LucideIcon> = {
    found: CircleCheck,
    partly_found: CircleDashed,
    not_found: CircleAlert,
    no_quote: CircleMinus,
    no_text: FileX,
    stale: History,
};

/**
 * Text colour per marker, drawn from the semantic status tokens so both themes
 * are handled by the token definitions rather than a per-class dark remap. The
 * paired icon and text carry the status, so colour only reinforces it.
 */
const MARKER_TEXT_CLASS: Record<QuoteMarkerKind, string> = {
    found: "text-success",
    partly_found: "text-warning",
    not_found: "text-danger",
    no_quote: "text-fg-subtle",
    no_text: "text-fg-subtle",
    stale: "text-warning",
};

/**
 * A tabular quote-check marker: an icon paired with plain text, e.g.
 * "Quote found". The text is the accessible name; the longer description is a
 * tooltip (shown on hover, on W26's tokens) rather than the browser's native
 * `title`, which never surfaces on keyboard focus. Presentational only.
 */
export function TabularQuoteMarker({
    kind,
    className,
}: {
    kind: QuoteMarkerKind;
    className?: string;
}) {
    const Icon = MARKER_ICON[kind];
    return (
        <Tooltip content={QUOTE_MARKER_DESCRIPTIONS[kind]}>
            <span
                data-quote-marker={kind}
                className={cn(
                    "inline-flex items-center gap-1 font-medium leading-none",
                    MARKER_TEXT_CLASS[kind],
                    className,
                )}
            >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span>{QUOTE_MARKER_LABELS[kind]}</span>
            </span>
        </Tooltip>
    );
}
