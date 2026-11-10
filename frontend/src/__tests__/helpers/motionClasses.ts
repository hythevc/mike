// SPDX-License-Identifier: AGPL-3.0-only
/*
 * Reads motion out of Tailwind class strings, for the tests that hold the
 * motion rules: motionRatchet.test.ts, motionPrimitives.test.tsx and
 * popover.motion.test.tsx. Test-only; the `__tests__` directory keeps it out
 * of the production build (see tsconfig.build.json).
 *
 * The fact these checks exist for: Tailwind v4 writes `scale-*`, `translate-*`
 * and `rotate-*` as the individual CSS properties of those names, not as
 * `transform`. A transition has to list the property a utility really sets,
 * or the change snaps while the class string still reads as animated.
 */

/** The easing utilities DesignTokensUI.css declares. */
export const TOKEN_EASINGS: readonly string[] = [
    "ease-out-strong",
    "ease-out-soft",
    "ease-in-out-soft",
];

/** Source text with its comments blanked out and every line kept in place. */
export function stripComments(source: string): string {
    return (
        source
            .replace(/\/\*[\s\S]*?\*\//g, (comment) =>
                comment.replace(/[^\n]/g, " "),
            )
            // Not after a colon or inside a quote: `https://` is not a comment.
            .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    );
}

/** Whitespace- and quote-separated tokens: every class in a string. */
export function classTokens(text: string): string[] {
    return text.split(/[\s"'`]+/).filter(Boolean);
}

/**
 * A class token split into its variants and its utility:
 * `motion-reduce:active:scale-100` is `["motion-reduce", "active"]` and
 * `scale-100`. A colon inside brackets belongs to an arbitrary value.
 */
export function parseClass(token: string): {
    variants: string[];
    utility: string;
} {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < token.length; index += 1) {
        const char = token[index];
        if (char === "[" || char === "(") depth += 1;
        else if (char === "]" || char === ")") depth -= 1;
        else if (char === ":" && depth === 0) {
            parts.push(token.slice(start, index));
            start = index + 1;
        }
    }
    return { variants: parts, utility: token.slice(start) };
}

/** A transition utility that says which properties it moves. */
const EXPLICIT_PROPERTY_LIST =
    /^transition-(\[.+\]|transform|opacity|colors|shadow)$/;

/** A transition that can move or resize something, as opposed to a fade. */
const MOVING_TRANSITION = /^transition-(\[.+\]|transform)$/;

const TRANSFORM_UTILITY = /^-?(scale|translate|rotate)-/;

/** Variants that say where or when a class applies, not which state it is. */
const NOT_A_STATE =
    /^(before|after|dark|motion-reduce|motion-safe|sm|md|lg|xl|2xl|max-.+|min-.+)$/;

/**
 * The CSS properties a class string's transition lists, or null when it has
 * no transition utility. `transition-transform` is Tailwind's shorthand for
 * `transform` and the three individual transform properties.
 */
export function transitionedProperties(classes: string): string[] | null {
    for (const token of classTokens(classes)) {
        const { variants, utility } = parseClass(token);
        if (variants.length > 0) continue;
        const arbitrary = /^transition-\[(.+)\]$/.exec(utility);
        if (arbitrary) {
            return arbitrary[1].split(",").map((property) => property.trim());
        }
        if (utility === "transition-transform") {
            return ["transform", "translate", "scale", "rotate"];
        }
        if (utility === "transition-opacity") return ["opacity"];
        if (utility === "transition-colors") return ["colors"];
        if (utility === "transition-shadow") return ["box-shadow"];
        // The bare utility's default list covers the transform properties
        // too, so for this purpose it is as wide as the blanket one. (A
        // pattern, so this file does not spell the class the ratchet counts.)
        if (/^transition(-all)?$/.test(utility)) return ["all"];
    }
    return null;
}

/**
 * The `scale-*`, `translate-*` and `rotate-*` classes in a string whose
 * property its transition does not list, so the change they make would snap.
 * With `onlyStates`, a class that is always on is taken for fixed placement
 * (`-translate-x-1/2` centring something) and left alone; without it, every
 * transform class counts, which suits a string built for one animated element.
 */
export function snappingTransforms(
    classes: string,
    { onlyStates = false }: { onlyStates?: boolean } = {},
): string[] {
    const listed = transitionedProperties(classes);
    if (listed === null || listed.includes("all")) return [];
    return classTokens(classes).filter((token) => {
        const { variants, utility } = parseClass(token);
        // A pseudo-element is another box; it has no transition here.
        if (variants.includes("before") || variants.includes("after")) {
            return false;
        }
        if (
            onlyStates &&
            !variants.some((variant) => !NOT_A_STATE.test(variant))
        ) {
            return false;
        }
        const match = TRANSFORM_UTILITY.exec(utility);
        return match !== null && !listed.includes(match[1]);
    });
}

/**
 * Timing classes that do not read a motion token: a `duration-*`,
 * `animation-duration-*` or `delay-*` that is not `(--motion-duration-…)`, an
 * `ease-*` that is not one of the three token curves, and an arbitrary
 * `[transition…:…]` or `[animation…:…]` property.
 */
export function untokenedTiming(text: string): string[] {
    return classTokens(text).filter((token) => {
        const { utility } = parseClass(token);
        if (/^(animation-)?duration-/.test(utility)) {
            return !/^(animation-)?duration-\(--motion-duration-[a-z]+\)$/.test(
                utility,
            );
        }
        if (/^delay-/.test(utility)) {
            return !/^delay-\(--motion-duration-[a-z]+\)$/.test(utility);
        }
        if (/^ease-/.test(utility)) return !TOKEN_EASINGS.includes(utility);
        return /^\[(transition|animation)[a-z-]*:/.test(utility);
    });
}

/**
 * What is wrong with the transition one class string describes, in words; an
 * empty list when it follows the rules in docs/design-system.md ("Motion").
 *
 * `tokenDuration: false` is for the one transition whose duration is set
 * inline because it depends on a measured distance (the sidebar title slide).
 */
export function transitionProblems(
    classes: string,
    {
        tokenDuration = true,
        onlyStates = false,
    }: { tokenDuration?: boolean; onlyStates?: boolean } = {},
): string[] {
    const utilities = classTokens(classes).map((token) => parseClass(token));
    const base = utilities
        .filter(({ variants }) => variants.length === 0)
        .map(({ utility }) => utility);
    const problems: string[] = [];

    const setsDuration = utilities.some(({ utility }) =>
        /^duration-/.test(utility),
    );
    const explicitList = base.some((utility) =>
        EXPLICIT_PROPERTY_LIST.test(utility),
    );
    if (setsDuration && !explicitList) {
        problems.push(
            "sets a transition duration with no transition property list, so every property would transition",
        );
    }

    const transformOrOpacity = base.some(
        (utility) =>
            MOVING_TRANSITION.test(utility) || utility === "transition-opacity",
    );
    const tokenTimed = base.some((utility) =>
        /^duration-\(--motion-duration-[a-z]+\)$/.test(utility),
    );
    if (tokenDuration && transformOrOpacity && !tokenTimed) {
        // A state may change the duration (a toast's exit), but one is
        // always in force.
        const variantTimed = utilities.some(
            ({ variants, utility }) =>
                variants.length > 0 &&
                /^duration-\(--motion-duration-[a-z]+\)$/.test(utility),
        );
        if (!variantTimed) {
            problems.push(
                "transitions transform or opacity on Tailwind's default duration, not a --motion-duration-* token",
            );
        }
    }

    const moves = base.some((utility) => MOVING_TRANSITION.test(utility));
    const reducedMotion = utilities.some(({ variants }) =>
        variants.includes("motion-reduce"),
    );
    if (moves && !reducedMotion) {
        problems.push("moves or resizes with no motion-reduce: variant");
    }

    for (const token of snappingTransforms(classes, { onlyStates })) {
        problems.push(
            `${token} would snap: the transition does not list the property it sets`,
        );
    }
    return problems;
}

const parsedClasses = (classes: string) =>
    classTokens(classes).map((token) => ({ token, ...parseClass(token) }));

/** `zoom-in-[0.98]` is 0.98 and `zoom-in-95` is 0.95; null when unreadable. */
function zoomValue(utility: string): number | null {
    const arbitrary = /^zoom-(?:in|out)-\[([\d.]+)\]$/.exec(utility);
    if (arbitrary) return Number(arbitrary[1]);
    const scale = /^zoom-(?:in|out)-(\d+)$/.exec(utility);
    return scale ? Number(scale[1]) / 100 : null;
}

/**
 * Where a menu or popover surface's class string departs from the contract in
 * docs/design-system.md: enter and exit on opacity, at most 2px of travel out
 * of the Radix transform origin, a scale no smaller than 0.98, token timing
 * with the exit on the shorter alias, and a reduced-motion variant. The
 * keyframes are tw-animate's, so the timing has to be `animation-duration-*`:
 * a `duration-*` here would turn every later style change into a transition.
 */
export function menuSurfaceProblems(
    classes: string,
    originVariable: string,
): string[] {
    const parsed = parsedClasses(classes);
    const has = (token: string) => parsed.some((item) => item.token === token);
    const problems: string[] = [];
    const need = (token: string) => {
        if (!has(token)) problems.push(`missing ${token}`);
    };

    need(`origin-(${originVariable})`);
    need("data-[state=open]:animate-in");
    need("data-[state=closed]:animate-out");
    need("data-[state=open]:fade-in-0");
    need("data-[state=closed]:fade-out-0");
    need("data-[state=open]:animation-duration-(--motion-duration-enter)");
    need("data-[state=closed]:animation-duration-(--motion-duration-exit)");
    need("motion-reduce:data-[state=open]:zoom-in-100");
    need("motion-reduce:data-[state=closed]:zoom-out-100");

    for (const state of ["open", "closed"]) {
        const eased = parsed.some(
            ({ variants, utility }) =>
                variants.includes(`data-[state=${state}]`) &&
                TOKEN_EASINGS.includes(utility),
        );
        if (!eased) problems.push(`no token easing while ${state}`);
    }

    const slides = parsed.filter(({ utility }) =>
        /^slide-(in-from|out-to)-/.test(utility),
    );
    for (const side of ["top", "bottom", "left", "right"]) {
        if (!slides.some(({ utility }) => utility.startsWith(`slide-in-from-${side}-`))) {
            problems.push(`no entrance from the ${side}`);
        }
    }
    for (const { token, utility } of slides) {
        const px = /-\[([\d.]+)px\]$/.exec(utility);
        if (!px || Number(px[1]) > 2) {
            problems.push(`${token} travels more than 2px`);
        }
    }

    const zooms = parsed.filter(({ utility }) => /^zoom-(in|out)-/.test(utility));
    if (!zooms.some(({ variants }) => !variants.includes("motion-reduce"))) {
        problems.push("no scale on the entrance");
    }
    for (const { token, utility } of zooms) {
        const value = zoomValue(utility);
        if (value === null || value < 0.98 || value > 1) {
            problems.push(`${token} scales below 0.98`);
        }
    }

    if (parsed.some(({ utility }) => /^(duration-|transition)/.test(utility))) {
        problems.push(
            "sets a transition on a surface that animates with keyframes",
        );
    }
    for (const token of untokenedTiming(classes)) {
        problems.push(`${token} is not token timing`);
    }
    return [...problems, ...transitionProblems(classes)];
}

/**
 * Where a pressable control's class string departs from the contract: it
 * lists exactly `scale` and `opacity`, presses on pointer-down with a scale on
 * the `instant` token, and under reduced motion swaps the scale for a cue that
 * does not move.
 */
export function pressProblems(classes: string): string[] {
    const parsed = parsedClasses(classes);
    const problems: string[] = [];

    const listed = transitionedProperties(classes);
    if (listed === null || [...listed].sort().join() !== "opacity,scale") {
        problems.push(
            `transitions ${listed?.join(", ") ?? "nothing"}, not scale and opacity`,
        );
    }

    const pressed = (reduced: boolean, test: (utility: string) => boolean) =>
        parsed.some(
            ({ variants, utility }) =>
                variants.includes("active") &&
                !variants.includes("disabled") &&
                variants.includes("motion-reduce") === reduced &&
                test(utility),
        );
    if (!pressed(false, (utility) => /^scale-/.test(utility) && utility !== "scale-100")) {
        problems.push("no pointer-down press scale");
    }
    if (!pressed(true, (utility) => utility === "scale-100")) {
        problems.push("the press still scales under reduced motion");
    }
    if (!pressed(true, (utility) => /^opacity-/.test(utility))) {
        problems.push("reduced motion leaves the press with no cue at all");
    }

    const base = parsed
        .filter(({ variants }) => variants.length === 0)
        .map(({ utility }) => utility);
    if (!base.includes("duration-(--motion-duration-instant)")) {
        problems.push("the press is not on the instant duration token");
    }
    if (!base.some((utility) => TOKEN_EASINGS.includes(utility))) {
        problems.push("the press has no token easing");
    }
    for (const token of untokenedTiming(classes)) {
        problems.push(`${token} is not token timing`);
    }
    return [...problems, ...transitionProblems(classes)];
}
