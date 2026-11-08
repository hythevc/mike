// SPDX-License-Identifier: AGPL-3.0-only
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabularQuoteMarker } from "./TabularQuoteMarker";
import {
    QUOTE_MARKER_DESCRIPTIONS,
    QUOTE_MARKER_LABELS,
    type QuoteMarkerKind,
} from "./tabularQuoteLabels";

const KINDS: QuoteMarkerKind[] = [
    "found",
    "partly_found",
    "not_found",
    "no_quote",
    "no_text",
    "stale",
];

describe("TabularQuoteMarker", () => {
    it.each(KINDS)(
        "shows %s as visible text with an accessible description and a decorative icon",
        (kind) => {
            const { container } = render(<TabularQuoteMarker kind={kind} />);
            const marker = container.querySelector(
                `[data-quote-marker="${kind}"]`,
            );
            expect(marker).not.toBeNull();
            // Visible text (the plain-language label), never colour alone.
            expect(marker).toHaveTextContent(QUOTE_MARKER_LABELS[kind]);
            // Accessible description on hover / to assistive tech.
            expect(marker).toHaveAttribute(
                "title",
                QUOTE_MARKER_DESCRIPTIONS[kind],
            );
            // The icon repeats the status visually but is hidden from the
            // accessibility tree so the text carries the meaning.
            const icon = marker?.querySelector("svg");
            expect(icon).toHaveAttribute("aria-hidden", "true");
        },
    );
});
