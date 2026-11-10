// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { classTokens, menuSurfaceProblems } from "@/__tests__/helpers/motionClasses";
import { DROPDOWN_CONTENT_MOTION_CLASS } from "@/shared/ui/dropdown";
import { POPOVER_CONTENT_MOTION_CLASS } from "./popover";

/*
 * Motion contract for the popover surface (W26): the same fade, at most 2px of
 * travel and 0.98 scale as the menu, on the Radix popover transform origin,
 * with a reduced-motion variant and the exit on the shorter duration token.
 * The contract itself is `menuSurfaceProblems` in src/__tests__/helpers/motionClasses.ts,
 * which motionPrimitives.test.tsx exercises against drifted class strings.
 */

describe("popover content motion", () => {
    it("enters and exits on the Radix popover origin", () => {
        expect(
            menuSurfaceProblems(
                POPOVER_CONTENT_MOTION_CLASS,
                "--radix-popover-content-transform-origin",
            ),
        ).toEqual([]);
    });

    it("moves exactly as the menu does, apart from its origin", () => {
        const withoutOrigin = (classes: string) =>
            classTokens(classes).filter((token) => !token.startsWith("origin-"));
        expect(withoutOrigin(POPOVER_CONTENT_MOTION_CLASS)).toEqual(
            withoutOrigin(DROPDOWN_CONTENT_MOTION_CLASS),
        );
    });
});
