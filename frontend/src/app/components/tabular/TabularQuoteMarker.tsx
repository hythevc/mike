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
 * Text colour per marker. Each class is remapped for the dark theme in
 * globals.css, so the marker stays legible in both themes; the paired icon and
 * text mean colour is a reinforcement, not the signal.
 */
const MARKER_TEXT_CLASS: Record<QuoteMarkerKind, string> = {
    found: "text-emerald-700",
    partly_found: "text-amber-800",
    not_found: "text-red-700",
    no_quote: "text-gray-600",
    no_text: "text-gray-600",
    stale: "text-amber-800",
};

/**
 * A tabular quote-check marker: an icon paired with plain text, e.g.
 * "Quote found". The text is the accessible name; the longer description is
 * the tooltip. Presentational only.
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
        <span
            data-quote-marker={kind}
            title={QUOTE_MARKER_DESCRIPTIONS[kind]}
            className={cn(
                "inline-flex items-center gap-1 font-medium leading-none",
                MARKER_TEXT_CLASS[kind],
                className,
            )}
        >
            <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>{QUOTE_MARKER_LABELS[kind]}</span>
        </span>
    );
}
