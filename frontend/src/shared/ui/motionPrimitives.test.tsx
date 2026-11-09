// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DROPDOWN_CONTENT_MOTION_CLASS } from "./dropdown";
import {
    TOAST_MOTION_BASE_CLASS,
    TOAST_ENTER_CLASS,
    TOAST_EXIT_CLASS,
} from "./ToastUI";
import { pillButtonUIClassName } from "./PillButtonUI.styles";
import { COMPOSER_SEND_BUTTON_CLASS } from "./ComposerSendButtonUI.styles";
import { glassIconButtonUIClassName } from "./GlassIconButtonUI";
import { TabPillButtonUI } from "./TabPillButtonUI";

/*
 * Motion contract for the highest-frequency primitives (W26): token-based,
 * transform/opacity-only, with a reduced-motion escape. The exact timing lives
 * in the motion tokens (motionTokens.test.ts); these pin what each surface
 * animates and that it never reaches for `transition-all`.
 */

/** A menu/popover surface animates a fade, ≤2px of travel and a 0.98 scale. */
function expectMenuSurfaceMotion(cls: string) {
    // Enter and exit.
    expect(cls).toContain("data-[state=open]:animate-in");
    expect(cls).toContain("data-[state=closed]:animate-out");
    // Opacity.
    expect(cls).toContain("fade-in-0");
    expect(cls).toContain("fade-out-0");
    // At most 2px of travel: an explicit [2px], never a spacing-scale slide.
    expect(cls).toContain("slide-in-from-top-[2px]");
    expect(cls).not.toMatch(/slide-in-from-\w+-\d/);
    // Scale no smaller than 0.98.
    expect(cls).toContain("zoom-in-[0.98]");
    expect(cls).toContain("zoom-out-[0.98]");
    expect(cls).not.toMatch(/zoom-(in|out)-9\d\b/);
    // Exit a tier quicker than the enter.
    expect(cls).toContain("data-[state=open]:duration-(--motion-duration-enter)");
    expect(cls).toContain(
        "data-[state=closed]:duration-(--motion-duration-exit)",
    );
    // A reduced-motion variant.
    expect(cls).toContain("motion-reduce:");
    // Never the blanket property list.
    expect(cls).not.toContain("transition-all");
}

/** A pressable control lists its transitioned properties and backs the press
 *  off under reduced motion. */
function expectPressMotion(cls: string) {
    expect(cls).not.toContain("transition-all");
    expect(cls).toMatch(/transition-(transform|opacity|\[)/);
    expect(cls).toMatch(/active:(enabled:)?scale-/);
    expect(cls).toMatch(/motion-reduce:active:(enabled:)?scale-/);
    expect(cls).toContain("duration-(--motion-duration-");
}

describe("menu surface motion", () => {
    it("the dropdown content declares enter/exit on the Radix origin", () => {
        expectMenuSurfaceMotion(DROPDOWN_CONTENT_MOTION_CLASS);
        expect(DROPDOWN_CONTENT_MOTION_CLASS).toContain(
            "origin-(--radix-dropdown-menu-content-transform-origin)",
        );
    });
});

describe("pressable primitives", () => {
    it("PillButton lists its properties and carries a reduced-motion press", () => {
        expectPressMotion(pillButtonUIClassName({ tone: "black" }));
    });

    it("ComposerSendButton lists its properties and carries a press", () => {
        expectPressMotion(COMPOSER_SEND_BUTTON_CLASS);
    });

    it("GlassIconButton lists its properties and carries a press", () => {
        expectPressMotion(glassIconButtonUIClassName());
    });

    it("TabPillButton lists its properties and carries a press", () => {
        render(<TabPillButtonUI>Tab</TabPillButtonUI>);
        expectPressMotion(screen.getByRole("button").className);
    });
});

describe("toast motion", () => {
    it("enters and exits on transform and opacity only", () => {
        expect(TOAST_MOTION_BASE_CLASS).toContain("transition-[transform,opacity]");
        expect(TOAST_MOTION_BASE_CLASS).toContain("motion-reduce:");
        expect(TOAST_MOTION_BASE_CLASS).not.toContain("transition-all");
        for (const token of [
            ...TOAST_ENTER_CLASS.split(" "),
            ...TOAST_EXIT_CLASS.split(" "),
        ]) {
            expect(token, `${token} is transform or opacity`).toMatch(
                /^(-?translate-|opacity-|scale-)/,
            );
        }
    });
});
