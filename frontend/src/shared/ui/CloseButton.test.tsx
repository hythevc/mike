// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloseButton } from "./CloseButton";

// WCAG 2.5.8 asks for a 24x24 CSS-pixel target. The ✕ glyph stays small, so
// the button carries a centred 24x24 pseudo-element that extends the pointer
// and keyboard target past the glyph. jsdom cannot measure layout, so the test
// pins the classes that produce that 24x24 region.
describe("CloseButton", () => {
    it.each(["sm", "md"] as const)(
        "gives the %s button a 24x24 hit area around the glyph",
        (size) => {
            render(<CloseButton size={size} onClick={() => {}} />);
            const button = screen.getByRole("button", { name: "Close" });
            // 24x24 target: a size-6 (1.5rem) pseudo-element centred on the
            // positioned button.
            expect(button).toHaveClass(
                "relative",
                "before:size-6",
                "before:absolute",
                "before:left-1/2",
                "before:top-1/2",
                "before:-translate-x-1/2",
                "before:-translate-y-1/2",
            );
            // The glyph itself is decorative and hidden from assistive tech.
            expect(button.querySelector("svg")).toHaveAttribute(
                "aria-hidden",
                "true",
            );
        },
    );

    it("uses the given label as its accessible name and fires onClick", async () => {
        const onClick = vi.fn();
        render(<CloseButton label="Dismiss" onClick={onClick} />);
        const button = screen.getByRole("button", { name: "Dismiss" });
        button.click();
        expect(onClick).toHaveBeenCalledOnce();
    });
});
