// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
    stripComments,
    transitionProblems,
    transitionedProperties,
    untokenedTiming,
} from "@/__tests__/helpers/motionClasses";
import { SIDEBAR_TITLE_SLIDE_CLASS } from "@/app/components/shared/useSidebarTitleSlide";

/*
 * Interface-motion ratchet (W26). The web app had no shared motion vocabulary:
 * 18 controls used `transition-all` (which animates layout and colour on every
 * hover), and an `animate-[name …]` keyframe could ship with no reduced-motion
 * escape. This guard makes the clean-up one-way. It counts, per file:
 *
 *   - `transition-all`              — must be a scoped property list instead;
 *   - a bare `ease-in` on motion    — entrances ease OUT, not in;
 *   - an `animate-[name …]` whose    — every keyframe utility needs a
 *     keyframe MotionUI.css does       reduced-motion rule.
 *     not neutralise
 *
 * Every file under frontend/src must hold zero, except the ones recorded in
 * motionRatchet.json (the assistant chrome W29 still owns). The test fails when
 * a count rises above the record; lower a record when a file is migrated.
 *
 * The files this item migrated are held to more: their timing comes from the
 * motion tokens only, and each transition names the properties it moves, a
 * token duration and a reduced-motion variant in one class string.
 */

const FRONTEND = process.cwd();
const SRC = resolve(FRONTEND, "src");
const MOTION_CSS = resolve(SRC, "shared/ui/MotionUI.css");

const ratchet = JSON.parse(
    readFileSync(resolve(SRC, "app/motionRatchet.json"), "utf8"),
) as { max: number; files: Record<string, { transitionAll?: number }> };

/** Surfaces W26 migrated. */
const MIGRATED_FILES = [
    "shared/ui/dropdown.tsx",
    "app/components/ui/popover.tsx",
    "shared/ui/ToastUI.tsx",
    "shared/ui/PillButtonUI.styles.ts",
    "shared/ui/TabPillButtonUI.tsx",
    "shared/ui/ComposerSendButtonUI.styles.ts",
    "shared/ui/GlassIconButtonUI.tsx",
    "app/components/shared/AppSidebar.tsx",
    "app/components/shared/useSidebarTitleSlide.ts",
    "app/components/shared/DocumentSidePanel.tsx",
    "app/components/shared/FileDirectory.tsx",
    "app/components/shared/HeaderActionsMenu.tsx",
    "app/components/modals/ModalSelect.tsx",
    "app/components/modals/ProjectPickerModal.tsx",
    "app/components/playbooks/PlaybookPickerModal.tsx",
    "app/components/workflows/WorkflowPickerContent.tsx",
    "app/components/workflows/WFEditColumnModal.tsx",
    "app/components/site-logo.tsx",
];

/**
 * Migrated files that assemble a class string from several constants, so no
 * single line holds a whole transition. motionPrimitives.test.tsx and
 * popover.motion.test.tsx run the same rules on the assembled strings.
 */
const ASSEMBLED_ELSEWHERE = new Set([
    "shared/ui/dropdown.tsx",
    "app/components/ui/popover.tsx",
    "shared/ui/ToastUI.tsx",
]);

/**
 * The one transition whose duration is not a token: the sidebar's long-title
 * slide is paced by the distance it has to cover, set inline per row.
 */
const DISTANCE_PACED = "app/components/shared/useSidebarTitleSlide.ts";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);

/** Source files the ratchet scans: .ts/.tsx/.css, minus tests, stories and the
 *  reduced-motion stylesheet itself (which names keyframes to neutralise them,
 *  not to run them). */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path);
        }
        if (path === MOTION_CSS) return [];
        if (/\.test\.tsx?$/.test(entry.name)) return [];
        if (/\.stories\.tsx?$/.test(entry.name)) return [];
        return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
    });
}

/** Selectors MotionUI.css stops, with `animation: none`, under reduced motion.
 *  Parsed, so a comment or a longer selector cannot stand in for a rule. */
const stoppedSelectors = new Set<string>();
postcss.parse(readFileSync(MOTION_CSS, "utf8")).walkAtRules("media", (media) => {
    if (media.params !== "(prefers-reduced-motion: reduce)") return;
    media.walkRules((rule) => {
        let stops = false;
        rule.walkDecls("animation", (decl) => {
            if (decl.value.trim() === "none") stops = true;
        });
        if (stops) for (const selector of rule.selectors) stoppedSelectors.add(selector);
    });
});

/** A keyframe utility is covered when MotionUI.css stops it under reduced
 *  motion, which it does through an `[class*="animate-[<name>"]` selector. */
function keyframeIsNeutralised(name: string): boolean {
    return stoppedSelectors.has(`[class*="animate-[${name}"]`);
}

interface Counts {
    transitionAll: number;
    easeInBare: number;
    animateUncovered: number;
}

function countSignals(text: string): Counts {
    const transitionAll = (text.match(/transition-all/g) ?? []).length;
    // `ease-in` but not `ease-in-out`, `ease-in-out-soft`, `ease-in-expo`, …
    const easeInBare = (text.match(/ease-in(?![-\w])/g) ?? []).length;
    let animateUncovered = 0;
    // tw-animate's `animate-[name_dur_…]` uses `_` to separate the keyframe
    // name from its parameters, so the name stops at the first underscore.
    for (const match of text.matchAll(/animate-\[([a-zA-Z][a-zA-Z0-9-]*)/g)) {
        if (!keyframeIsNeutralised(match[1])) animateUncovered += 1;
    }
    return { transitionAll, easeInBare, animateUncovered };
}

const scanned = sourceFiles(SRC).map((path) => ({
    rel: relative(FRONTEND, path).split("\\").join("/"),
    counts: countSignals(readFileSync(path, "utf8")),
}));

const total = (counts: Counts) =>
    counts.transitionAll + counts.easeInBare + counts.animateUncovered;

/** A migrated file's code, without its comments. */
const migratedSource = (rel: string) =>
    stripComments(readFileSync(resolve(SRC, rel), "utf8"));

describe("interface-motion ratchet", () => {
    it("parses a non-empty source tree and a reduced-motion block", () => {
        expect(scanned.length).toBeGreaterThan(100);
        expect(stoppedSelectors.size).toBeGreaterThan(0);
    });

    it("no file outside the recorded set carries an anti-pattern", () => {
        const offenders = scanned
            .filter(({ rel, counts }) => total(counts) > 0 && !ratchet.files[rel])
            .map(({ rel, counts }) => `${rel}: ${JSON.stringify(counts)}`);
        expect(offenders).toEqual([]);
    });

    it("recorded files stay within their budget and the total is the max", () => {
        let sum = 0;
        for (const { rel, counts } of scanned) {
            const allowed = ratchet.files[rel];
            if (!allowed) continue;
            // Only `transition-all` is recorded today; the others must be zero
            // even on a recorded file.
            expect(counts.transitionAll).toBeLessThanOrEqual(
                allowed.transitionAll ?? 0,
            );
            expect(counts.easeInBare).toBe(0);
            expect(counts.animateUncovered).toBe(0);
            sum += total(counts);
        }
        expect(sum).toBeLessThanOrEqual(ratchet.max);
        // The recorded max reflects exactly the two assistant files.
        const recordedSum = Object.values(ratchet.files).reduce(
            (acc, entry) => acc + (entry.transitionAll ?? 0),
            0,
        );
        expect(ratchet.max).toBe(recordedSum);
    });

    it("an arbitrary keyframe utility counts as covered only through its own rule", () => {
        // The loaders MotionUI.css stops by name...
        for (const name of ["pulse", "spin", "bounce", "shimmer"]) {
            expect(keyframeIsNeutralised(name), name).toBe(true);
        }
        // ...and nothing that merely shares a prefix or appears in a comment.
        expect(keyframeIsNeutralised("shim")).toBe(false);
        expect(keyframeIsNeutralised("typing")).toBe(false);
        expect(countSignals('"animate-[typing_1s_infinite]"').animateUncovered).toBe(1);
    });
});

describe("the migrated surfaces", () => {
    it("time their motion with the tokens only", () => {
        // No `duration-150`, `duration-[200ms]` or `delay-*` literal, no
        // off-token `ease-*`, and no arbitrary `[transition:…]` property.
        for (const rel of MIGRATED_FILES) {
            expect(
                untokenedTiming(migratedSource(rel)),
                `${rel} times motion without a --motion-duration-* or --ease-* token`,
            ).toEqual([]);
        }
    });

    it("write each transition whole: its properties, a token duration, a reduced-motion variant", () => {
        const problems: string[] = [];
        let examined = 0;
        for (const rel of MIGRATED_FILES) {
            if (ASSEMBLED_ELSEWHERE.has(rel)) continue;
            migratedSource(rel)
                .split("\n")
                .forEach((line, index) => {
                    if (transitionedProperties(line) !== null) examined += 1;
                    const found = transitionProblems(line, {
                        tokenDuration: rel !== DISTANCE_PACED,
                        // A transform class that is always on places the
                        // element; only one tied to a state can snap.
                        onlyStates: true,
                    });
                    for (const problem of found) {
                        problems.push(`${rel}:${index + 1} ${problem}`);
                    }
                });
        }
        // Keep a transition's property list, its `duration-(--motion-duration-*)`
        // and its `motion-reduce:` variant in the same class string.
        expect(problems).toEqual([]);
        // The scan really reads transitions: the pressables, the sidebar and
        // the pickers hold a few dozen between them.
        expect(examined).toBeGreaterThan(10);
    });

    it("leave one duration off the tokens: the title slide, paced by distance", () => {
        const source = migratedSource(DISTANCE_PACED);
        expect(source).toMatch(/transitionDuration:/);
        expect(SIDEBAR_TITLE_SLIDE_CLASS).toContain("transition-transform");
        expect(SIDEBAR_TITLE_SLIDE_CLASS).toContain("ease-in-out-soft");
        expect(
            transitionProblems(SIDEBAR_TITLE_SLIDE_CLASS, { tokenDuration: false }),
        ).toEqual([]);
        // Held to the token rule like any other, it is the one that fails.
        expect(transitionProblems(SIDEBAR_TITLE_SLIDE_CLASS)).toHaveLength(1);
    });
});

describe("the transition rules", () => {
    const press =
        "transition-[scale,opacity] duration-(--motion-duration-instant) ease-out-soft active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:active:opacity-70";

    it("pass a transition that is written whole", () => {
        expect(transitionProblems(press)).toEqual([]);
        expect(untokenedTiming(press)).toEqual([]);
    });

    it("catch a press whose list names `transform` while the class sets `scale`", () => {
        // What shipped first: it read as animated and snapped in the browser.
        const problems = transitionProblems(
            press.replace("transition-[scale,opacity]", "transition-[transform,opacity]"),
        );
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain("active:scale-[0.98] would snap");
        expect(problems[1]).toContain("motion-reduce:active:scale-100 would snap");
    });

    it("catch a duration with no property list, which transitions everything", () => {
        expect(
            transitionProblems("data-[state=open]:duration-(--motion-duration-enter)"),
        ).toEqual([expect.stringContaining("no transition property list")]);
        // The animation's own duration utility starts no transition.
        expect(
            transitionProblems(
                "data-[state=open]:animation-duration-(--motion-duration-enter)",
            ),
        ).toEqual([]);
    });

    it("catch a fade or a move left on Tailwind's default timing", () => {
        expect(transitionProblems("hover:opacity-80 transition-opacity")).toEqual([
            expect.stringContaining("default duration"),
        ]);
    });

    it("catch a move with no reduced-motion variant", () => {
        expect(
            transitionProblems(
                "transition-transform duration-(--motion-duration-fast) rotate-180",
            ),
        ).toEqual([expect.stringContaining("no motion-reduce: variant")]);
    });

    it("leave a class that only places an element alone when asked to", () => {
        const placed =
            "-translate-x-1/2 transition-colors hover:bg-blue-600/60";
        expect(transitionProblems(placed, { onlyStates: true })).toEqual([]);
        expect(
            transitionProblems(`${placed} hover:translate-x-0`, { onlyStates: true }),
        ).toEqual([expect.stringContaining("hover:translate-x-0 would snap")]);
    });

    it("catch timing that is not a token", () => {
        expect(
            untokenedTiming(
                "duration-150 duration-[200ms] hover:delay-100 animation-duration-[2s] ease-in-out [transition:border-radius_300ms] duration-(--motion-duration-fast) animation-duration-(--motion-duration-enter) ease-out-soft",
            ),
        ).toEqual([
            "duration-150",
            "duration-[200ms]",
            "hover:delay-100",
            "animation-duration-[2s]",
            "ease-in-out",
            "[transition:border-radius_300ms]",
        ]);
    });

    it("read code, not comments", () => {
        const source = [
            "// a `transition-[transform,opacity]` list would snap",
            "/* duration-150 once */",
            'const cls = "transition-opacity duration-(--motion-duration-fast)"; // ease-in-out',
        ].join("\n");
        const code = stripComments(source);
        expect(code.split("\n")).toHaveLength(3);
        expect(untokenedTiming(code)).toEqual([]);
        expect(code).toContain("duration-(--motion-duration-fast)");
        expect(code).not.toContain("transform");
    });
});
