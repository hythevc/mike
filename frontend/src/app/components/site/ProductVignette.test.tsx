// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QUOTE_MARKER_LABELS } from "@/app/components/tabular/tabularQuoteLabels";
import { VIGNETTE_PLACEHOLDERS } from "@/content/site/placeholders";
import { ProductVignette } from "./ProductVignette";

function vignette(container: HTMLElement): HTMLElement {
    return container.querySelector('[data-slot="product-vignette"]') as HTMLElement;
}

describe("ProductVignette", () => {
    it("is a picture: hidden from assistive technology and inert", () => {
        const { container } = render(<ProductVignette />);
        const root = vignette(container);
        expect(root).toHaveAttribute("aria-hidden", "true");
        expect(root).toHaveAttribute("inert");
        // Nothing in it is exposed as content or as a control.
        expect(screen.queryByRole("list")).toBeNull();
        expect(screen.queryByRole("listitem")).toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("link")).toBeNull();
        expect(root.querySelector("a, button, input, textarea, select, [tabindex]")).toBeNull();
        // It is still drawn: the text is there for a sighted reader.
        expect(screen.queryByText(VIGNETTE_PLACEHOLDERS.matterName)).not.toBeNull();
    });

    it("is built from the card, the quote slab and the quote-status marker", () => {
        const { container } = render(<ProductVignette />);
        const root = vignette(container);
        // The card surface, and one quote slab per answer.
        expect(root.querySelector(".liquid-glass-flat")).not.toBeNull();
        const items = root.querySelectorAll("li");
        expect(items).toHaveLength(VIGNETTE_PLACEHOLDERS.answers.length);
        // The real markers, with the product's own wording.
        const markers = [...root.querySelectorAll("[data-quote-marker]")];
        expect(markers.map((marker) => marker.getAttribute("data-quote-marker"))).toEqual(
            VIGNETTE_PLACEHOLDERS.answers.map((answer) => (answer.found ? "found" : "not_found")),
        );
        expect(markers[0]).toHaveTextContent(QUOTE_MARKER_LABELS.found);
        expect(markers[1]).toHaveTextContent(QUOTE_MARKER_LABELS.not_found);
    });

    it("shows a quote that was found and one that was not", () => {
        // The picture must not show only the flattering state.
        const states = VIGNETTE_PLACEHOLDERS.answers.map((answer) => answer.found);
        expect(states).toContain(true);
        expect(states).toContain(false);
    });

    it("draws each answer with the passage it quotes and the invented document's name", () => {
        const { container } = render(<ProductVignette />);
        const items = [...vignette(container).querySelectorAll("li")];
        VIGNETTE_PLACEHOLDERS.answers.forEach((answer, index) => {
            expect(items[index]).toHaveTextContent(answer.question);
            expect(items[index]).toHaveTextContent(answer.answer);
            // The passage is set as a quotation, the way the product sets one.
            expect(items[index]).toHaveTextContent(`“${answer.quote}”`);
            expect(items[index]).toHaveTextContent(VIGNETTE_PLACEHOLDERS.documentName);
        });
        expect(vignette(container)).toHaveTextContent(VIGNETTE_PLACEHOLDERS.label);
    });

    it("is static: no animation, no placeholder pulse and no image", () => {
        const { container } = render(<ProductVignette />);
        const root = vignette(container);
        for (const element of [root, ...root.querySelectorAll("*")]) {
            const className = element.getAttribute("class") ?? "";
            expect(className).not.toMatch(/\banimate-/);
            expect(className).not.toMatch(/\btransition-all\b/);
        }
        expect(root.querySelector("img, picture, video, canvas, iframe")).toBeNull();
    });
});
