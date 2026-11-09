// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { describe, expect, it } from "vitest";

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
 */

const FRONTEND = process.cwd();
const SRC = resolve(FRONTEND, "src");
const MOTION_CSS = resolve(SRC, "shared/ui/MotionUI.css");

const ratchet = JSON.parse(
    readFileSync(resolve(SRC, "app/motionRatchet.json"), "utf8"),
) as { max: number; files: Record<string, { transitionAll?: number }> };

/** Surfaces W26 migrated; each must use only token-based durations. */
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

const motionCss = readFileSync(MOTION_CSS, "utf8");
const reducedMotionBlock = motionCss.slice(
    motionCss.indexOf("prefers-reduced-motion: reduce"),
);

/** A keyframe utility is covered when MotionUI.css stops it under reduced
 *  motion, which it does through an `[class*="animate-[<name>"]` selector. */
function keyframeIsNeutralised(name: string): boolean {
    return reducedMotionBlock.includes(`animate-[${name}`);
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

describe("interface-motion ratchet", () => {
    it("parses a non-empty source tree and a reduced-motion block", () => {
        expect(scanned.length).toBeGreaterThan(100);
        expect(reducedMotionBlock).toContain("prefers-reduced-motion: reduce");
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

    it("the migrated surfaces use only token-based durations", () => {
        for (const rel of MIGRATED_FILES) {
            const text = readFileSync(resolve(SRC, rel), "utf8");
            const literals = text.match(/\bduration-\d/g) ?? [];
            expect(literals, `${rel} has a duration-<number> literal`).toEqual(
                [],
            );
        }
    });
});
