// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabularQuoteMarker } from "./TabularQuoteMarker";
import {
    QUOTE_MARKER_DESCRIPTIONS,
    QUOTE_MARKER_LABELS,
    type QuoteMarkerKind,
} from "./tabularQuoteLabels";

// The status colour each marker must use: the semantic status tokens, not raw
// palette grays or emerald/amber/red. Icon + text carry the status, so colour
// is only a reinforcement.
const EXPECTED_TOKEN: Record<QuoteMarkerKind, string> = {
    found: "text-success",
    partly_found: "text-warning",
    not_found: "text-danger",
    no_quote: "text-fg-subtle",
    no_text: "text-fg-subtle",
    stale: "text-warning",
};

const KINDS = Object.keys(EXPECTED_TOKEN) as QuoteMarkerKind[];

afterEach(() => vi.useRealTimers());

describe("TabularQuoteMarker", () => {
    it.each(KINDS)(
        "shows %s as visible text in a semantic status colour, with no native title and a decorative icon",
        (kind) => {
            const { container } = render(<TabularQuoteMarker kind={kind} />);
            const marker = container.querySelector(
                `[data-quote-marker="${kind}"]`,
            );
            expect(marker).not.toBeNull();
            // Visible plain-language label is the accessible name.
            expect(marker).toHaveTextContent(QUOTE_MARKER_LABELS[kind]);
            // Colour comes from the semantic status tokens.
            expect(marker).toHaveClass(EXPECTED_TOKEN[kind]);
            // The longer description is no longer a browser-native title.
            expect(marker).not.toHaveAttribute("title");
            // The icon repeats the status visually but is hidden from the
            // accessibility tree so the text carries the meaning.
            expect(marker?.querySelector("svg")).toHaveAttribute(
                "aria-hidden",
                "true",
            );
        },
    );

    it("exposes the longer description as a tooltip on hover", () => {
        vi.useFakeTimers();
        try {
            const { container } = render(<TabularQuoteMarker kind="found" />);
            const marker = container.querySelector(
                '[data-quote-marker="found"]',
            ) as HTMLElement;
            fireEvent.pointerEnter(marker, { pointerType: "mouse" });
            act(() => {
                vi.advanceTimersByTime(600);
            });
            const tooltip = screen.getByRole("tooltip");
            expect(tooltip).toHaveTextContent(QUOTE_MARKER_DESCRIPTIONS.found);
            expect(marker.getAttribute("aria-describedby")).toBe(tooltip.id);
        } finally {
            vi.useRealTimers();
        }
    });
});
