// SPDX-License-Identifier: AGPL-3.0-only
import type { JurisdictionEntry } from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { jurisdictionLabel, jurisdictionName } from "./jurisdictionLabels";

/**
 * Jurisdictions as a row of chips that say what they are and do nothing: the
 * matter's jurisdictions on its header, or a list somebody may read but not
 * change. Each chip shows the name; the code is in its tooltip.
 *
 * Text and fill are the semantic roles whose contrast is held in both themes
 * (tokenContrast.test.ts), and the hairline is what sets a chip apart from
 * the page, since the fill alone is nearly the page colour.
 */
export function JurisdictionChips({
    codes,
    entries,
    label,
    className,
}: {
    codes: readonly string[];
    entries: readonly JurisdictionEntry[];
    /** What the list is, for assistive technology. */
    label: string;
    className?: string;
}) {
    if (codes.length === 0) return null;
    return (
        <ul
            aria-label={label}
            data-slot="jurisdiction-chips"
            className={cn("flex min-w-0 flex-wrap gap-1.5", className)}
        >
            {codes.map((code) => (
                <li
                    key={code}
                    title={jurisdictionLabel(code, entries)}
                    className="inline-flex max-w-full items-center rounded-full border border-border-strong bg-surface px-2 py-0.5 text-xs text-fg-subtle"
                >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                        {jurisdictionName(code, entries)}
                    </span>
                </li>
            ))}
        </ul>
    );
}
