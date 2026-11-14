// SPDX-License-Identifier: AGPL-3.0-only
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Kbd } from "./kbd";

function setApplePlatform(platform: string | undefined) {
    Object.defineProperty(navigator, "userAgentData", {
        value: platform ? { platform } : undefined,
        configurable: true,
    });
}

afterEach(() => setApplePlatform(undefined));

describe("Kbd", () => {
    it("renders the Ctrl modifier off Apple platforms", () => {
        setApplePlatform("Windows");
        const { container } = render(<Kbd keys={["mod", "K"]} />);
        const kbd = container.querySelector("kbd");
        expect(kbd?.textContent).toBe("Ctrl K");
    });

    it("renders the ⌘ modifier on Apple platforms", () => {
        setApplePlatform("macOS");
        const { container } = render(<Kbd keys={["mod", "K"]} />);
        const kbd = container.querySelector("kbd");
        expect(kbd?.textContent).toBe("⌘ K");
    });

    it("joins a chord with a non-breaking space", () => {
        setApplePlatform("Windows");
        const { container } = render(<Kbd keys={["shift", "F10"]} />);
        const kbd = container.querySelector("kbd");
        expect(kbd?.textContent).toContain(" ");
        expect(kbd?.textContent).toBe("Shift F10");
    });

    it("holds the 11px type floor and never renders smaller", () => {
        const { container } = render(<Kbd keys={["escape"]} />);
        const kbd = container.querySelector("kbd");
        expect(kbd?.className).toContain("text-[11px]");
        // No smaller bracketed size (text-[10px], text-[9px], …) or text-[0.x].
        expect(kbd?.className).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
        expect(kbd?.className).not.toMatch(/text-\[0\./);
    });
});
