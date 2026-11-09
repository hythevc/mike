// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { POPOVER_CONTENT_MOTION_CLASS } from "./popover";

/*
 * Motion contract for the popover surface (W26): the same fade, ≤2px travel and
 * 0.98 scale as the menu, on the Radix popover transform origin, with a
 * reduced-motion escape and the exit a tier quicker than the enter.
 */

describe("popover content motion", () => {
    const cls = POPOVER_CONTENT_MOTION_CLASS;

    it("declares enter and exit on opacity plus ≤2px of travel", () => {
        expect(cls).toContain("data-[state=open]:animate-in");
        expect(cls).toContain("data-[state=closed]:animate-out");
        expect(cls).toContain("fade-in-0");
        expect(cls).toContain("fade-out-0");
        expect(cls).toContain("slide-in-from-top-[2px]");
        expect(cls).not.toMatch(/slide-in-from-\w+-\d/);
    });

    it("keeps the scale at 0.98 and the Radix transform origin", () => {
        expect(cls).toContain("zoom-in-[0.98]");
        expect(cls).toContain("zoom-out-[0.98]");
        expect(cls).not.toMatch(/zoom-(in|out)-9\d\b/);
        expect(cls).toContain(
            "origin-(--radix-popover-content-transform-origin)",
        );
    });

    it("runs the exit quicker than the enter, with a reduced-motion variant", () => {
        expect(cls).toContain(
            "data-[state=open]:duration-(--motion-duration-enter)",
        );
        expect(cls).toContain(
            "data-[state=closed]:duration-(--motion-duration-exit)",
        );
        expect(cls).toContain("motion-reduce:");
        expect(cls).not.toContain("transition-all");
    });
});
