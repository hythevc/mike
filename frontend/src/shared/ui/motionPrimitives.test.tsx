// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    classTokens,
    menuSurfaceProblems,
    parseClass,
    pressProblems,
    transitionProblems,
    transitionedProperties,
    untokenedTiming,
} from "@/__tests__/helpers/motionClasses";
import { DROPDOWN_CONTENT_MOTION_CLASS } from "./dropdown";
import {
    TOAST_ENTER_CLASS,
    TOAST_ENTER_DURATION_CLASS,
    TOAST_EXIT_CLASS,
    TOAST_EXIT_DURATION_CLASS,
    TOAST_MOTION_BASE_CLASS,
    toastMotionClassName,
    type ToastMotionState,
} from "./ToastUI";
import { pillButtonUIClassName } from "./PillButtonUI.styles";
import { COMPOSER_SEND_BUTTON_CLASS } from "./ComposerSendButtonUI.styles";
import { glassIconButtonUIClassName } from "./GlassIconButtonUI";
import { TabPillButtonUI } from "./TabPillButtonUI";

/*
 * Motion contract for the highest-frequency primitives (W26): token timing,
 * transform and opacity only, and a reduced-motion variant that is gentler
 * rather than frozen. The timings themselves are pinned in
 * motionTokens.test.ts.
 *
 * A class string can read as animated and still snap in the browser: Tailwind
 * v4 writes `scale-*`, `translate-*` and `rotate-*` as the individual CSS
 * properties, so a `transition-[transform,…]` list covers none of them. These
 * tests therefore check the property each class really sets against the list,
 * not just that a list is there (see src/__tests__/helpers/motionClasses.ts);
 * e2e/motion.spec.ts asks a real browser the same question.
 */

describe("menu surface motion", () => {
    it("the dropdown content enters and exits on the Radix origin", () => {
        expect(
            menuSurfaceProblems(
                DROPDOWN_CONTENT_MOTION_CLASS,
                "--radix-dropdown-menu-content-transform-origin",
            ),
        ).toEqual([]);
    });

    it("the contract notices a surface that drifts from it", () => {
        const origin = "--radix-dropdown-menu-content-transform-origin";
        const drift = (from: string, to: string) =>
            menuSurfaceProblems(
                DROPDOWN_CONTENT_MOTION_CLASS.replace(from, to),
                origin,
            );
        // The spacing-scale slide and the 95% zoom the menu had before.
        expect(drift("slide-in-from-top-[2px]", "slide-in-from-top-2")).toEqual([
            "data-[side=bottom]:slide-in-from-top-2 travels more than 2px",
        ]);
        expect(drift("zoom-in-[0.98]", "zoom-in-95")).toEqual([
            "data-[state=open]:zoom-in-95 scales below 0.98",
        ]);
        // `duration-*` also sets transition-duration, which on a surface with
        // no property list turns every style change into a transition.
        expect(
            drift(
                "data-[state=open]:animation-duration-(--motion-duration-enter)",
                "data-[state=open]:duration-(--motion-duration-enter)",
            ),
        ).toEqual([
            "missing data-[state=open]:animation-duration-(--motion-duration-enter)",
            "sets a transition on a surface that animates with keyframes",
            "sets a transition duration with no transition property list, so every property would transition",
        ]);
        expect(
            drift("motion-reduce:data-[state=open]:zoom-in-100", ""),
        ).toEqual(["missing motion-reduce:data-[state=open]:zoom-in-100"]);
    });
});

describe("pressable primitives", () => {
    it("PillButton presses on scale and dims instead under reduced motion", () => {
        for (const tone of ["black", "white", "blue", "danger"] as const) {
            expect(pressProblems(pillButtonUIClassName({ tone })), tone).toEqual([]);
        }
    });

    it("ComposerSendButton presses on scale and dims instead under reduced motion", () => {
        expect(pressProblems(COMPOSER_SEND_BUTTON_CLASS)).toEqual([]);
    });

    it("GlassIconButton presses on scale and dims instead under reduced motion", () => {
        expect(pressProblems(glassIconButtonUIClassName())).toEqual([]);
    });

    it("TabPillButton presses on scale and dims instead under reduced motion", () => {
        render(
            <>
                <TabPillButtonUI>Tab</TabPillButtonUI>
                <TabPillButtonUI active surface="flat">
                    Active
                </TabPillButtonUI>
            </>,
        );
        for (const button of screen.getAllByRole("button")) {
            expect(pressProblems(button.className), button.textContent ?? "").toEqual(
                [],
            );
        }
    });

    it("a disabled pill is not pressed back to full strength", () => {
        // `disabled:active:` outranks the reduced-motion press dim, so a
        // disabled control held down stays at its disabled opacity.
        const tokens = classTokens(pillButtonUIClassName({ tone: "black" }));
        expect(tokens).toContain("disabled:opacity-40");
        expect(tokens).toContain("disabled:active:opacity-40");
        expect(tokens).toContain("disabled:active:scale-100");
    });

    it("the contract notices the press this item first shipped", () => {
        // `transition-[transform,opacity]` beside `active:scale-[0.98]`: the
        // list named a property the press never sets, so it snapped.
        const snapped = pillButtonUIClassName({ tone: "black" }).replace(
            "transition-[scale,opacity]",
            "transition-[transform,opacity]",
        );
        expect(pressProblems(snapped)).toEqual([
            "transitions transform, opacity, not scale and opacity",
            "active:scale-[0.98] would snap: the transition does not list the property it sets",
            "motion-reduce:active:scale-100 would snap: the transition does not list the property it sets",
            "disabled:active:scale-100 would snap: the transition does not list the property it sets",
        ]);
        // And a press that reduced motion leaves with nothing to show.
        const frozen = pillButtonUIClassName({ tone: "black" }).replace(
            " motion-reduce:active:opacity-70",
            "",
        );
        expect(pressProblems(frozen)).toEqual([
            "reduced motion leaves the press with no cue at all",
        ]);
    });
});

describe("toast motion", () => {
    const STATES: ToastMotionState[] = ["entering", "shown", "leaving"];

    it("transitions translate and opacity, the properties its classes set", () => {
        for (const state of STATES) {
            const classes = toastMotionClassName(state);
            expect(transitionedProperties(classes), state).toEqual([
                "translate",
                "opacity",
            ]);
            expect(transitionProblems(classes), state).toEqual([]);
            expect(untokenedTiming(classes), state).toEqual([]);
        }
        expect(TOAST_MOTION_BASE_CLASS).toContain("ease-out-strong");
    });

    it("enters and exits on a transform and opacity only", () => {
        for (const token of [
            ...classTokens(TOAST_ENTER_CLASS),
            ...classTokens(TOAST_EXIT_CLASS),
        ]) {
            expect(parseClass(token).utility, token).toMatch(
                /^-?(translate|opacity)-/,
            );
        }
        // The two states differ in both, so there is something to animate.
        expect(TOAST_ENTER_CLASS).toContain("translate-y-0");
        expect(TOAST_ENTER_CLASS).toContain("opacity-100");
        expect(TOAST_EXIT_CLASS).toContain("-translate-y-1");
        expect(TOAST_EXIT_CLASS).toContain("opacity-0");
    });

    it("starts hidden, settles, and leaves hidden again", () => {
        const stateClasses = (state: ToastMotionState) =>
            classTokens(toastMotionClassName(state));
        for (const token of classTokens(TOAST_EXIT_CLASS)) {
            expect(stateClasses("entering")).toContain(token);
            expect(stateClasses("leaving")).toContain(token);
            expect(stateClasses("shown")).not.toContain(token);
        }
        for (const token of classTokens(TOAST_ENTER_CLASS)) {
            expect(stateClasses("shown")).toContain(token);
        }
    });

    it("leaves on the exit duration and arrives on the entrance one", () => {
        expect(TOAST_ENTER_DURATION_CLASS).toBe(
            "duration-(--motion-duration-enter)",
        );
        expect(TOAST_EXIT_DURATION_CLASS).toBe("duration-(--motion-duration-exit)");
        const durations = (state: ToastMotionState) =>
            classTokens(toastMotionClassName(state)).filter((token) =>
                token.startsWith("duration-"),
            );
        expect(durations("entering")).toEqual([TOAST_ENTER_DURATION_CLASS]);
        expect(durations("shown")).toEqual([TOAST_ENTER_DURATION_CLASS]);
        expect(durations("leaving")).toEqual([TOAST_EXIT_DURATION_CLASS]);
    });

    it("keeps its fade and drops its travel under reduced motion", () => {
        expect(classTokens(TOAST_MOTION_BASE_CLASS)).toContain(
            "motion-reduce:transition-opacity",
        );
        expect(classTokens(TOAST_MOTION_BASE_CLASS)).not.toContain(
            "motion-reduce:transition-none",
        );
        expect(classTokens(TOAST_EXIT_CLASS)).toContain(
            "motion-reduce:translate-y-0",
        );
    });
});
