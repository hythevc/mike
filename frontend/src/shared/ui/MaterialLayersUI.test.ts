// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// The material and state recipes (LiquidGlassUI.css, ThemeTokensUI.css) must
// sit in the `components` cascade layer of both entry stylesheets. Imported
// unlayered they beat every Tailwind utility, so a utility on the same
// element silently loses: the active fill of TabPillButtonUI never rendered.
// Class-presence tests on the primitives cannot see that, so these tests pin
// the layering itself. MotionUI.css must sit in the `utilities` layer after
// Tailwind's own utilities, or its reduced-motion rule loses to them.

const repoRoot = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const WEB_ENTRY = "frontend/src/app/globals.css";
const ADDIN_ENTRY = "word-addin/src/taskpane/styles.css";
const MOTION = "frontend/src/shared/ui/MotionUI.css";

interface CssImport {
    target: string;
    layer: string | null;
}

/** `@import` rules in source order, split into their target and layer. */
function imports(css: string): CssImport[] {
    const found: CssImport[] = [];
    postcss.parse(css).walkAtRules("import", (rule) => {
        const match = /^\s*(?:url\()?["']([^"']+)["']\)?\s*(.*)$/.exec(
            rule.params,
        );
        if (!match) throw new Error(`Unparsed @import: ${rule.params}`);
        const layer = /(?:^|\s)layer\(([^)]*)\)/.exec(match[2]);
        found.push({ target: match[1], layer: layer ? layer[1].trim() : null });
    });
    return found;
}

const ENTRIES = [
    [WEB_ENTRY, "../shared/ui/"],
    [ADDIN_ENTRY, "../../../frontend/src/shared/ui/"],
] as const;

describe("material stylesheet layers", () => {
    it.each(ENTRIES)(
        "%s imports LiquidGlassUI.css and ThemeTokensUI.css into the components layer",
        (entry, dir) => {
            const list = imports(read(entry));
            for (const file of ["LiquidGlassUI.css", "ThemeTokensUI.css"]) {
                expect(list).toContainEqual({
                    target: `${dir}${file}`,
                    layer: "components",
                });
            }
        },
    );

    it.each(ENTRIES)(
        "%s imports MotionUI.css into the utilities layer after tailwindcss",
        (entry, dir) => {
            const list = imports(read(entry));
            const motion = list.findIndex(
                (item) => item.target === `${dir}MotionUI.css`,
            );
            expect(motion).toBeGreaterThan(-1);
            expect(list[motion].layer).toBe("utilities");
            expect(motion).toBeGreaterThan(
                list.findIndex((item) => item.target === "tailwindcss"),
            );
        },
    );

    it.each(ENTRIES)(
        "%s imports no shared stylesheet that declares rules without a layer",
        (entry) => {
            // DesignTokensUI.css holds only the theme mapping and custom
            // properties, which cannot override a utility; tokens.css wraps
            // itself in `@layer base`. Anything else needs a layer.
            const unlayered = imports(read(entry))
                .filter((item) => item.layer === null)
                .map((item) => item.target.split("/").pop());
            for (const name of unlayered) {
                expect([
                    "tailwindcss",
                    "tw-animate-css",
                    "DesignTokensUI.css",
                    "tokens.css",
                ]).toContain(name);
            }
        },
    );
});

/**
 * The animation utilities W26 moved into MotionUI.css from globals.css, so
 * each sits beside the reduced-motion rule that stops it. A closed list: see
 * the structural test below.
 */
const MOTION_UTILITIES = [
    ".sidebar-fade-in",
    ".sidebar-fade-in-2",
    ".sidebar-heading-enter",
    ".uploading-ellipsis",
    ".uploading-ellipsis-one",
    ".uploading-ellipsis-two",
    ".uploading-ellipsis-three",
];

/** What those utilities declare: an animation and the box that holds it. */
const MOTION_UTILITY_PROPERTIES = [
    "animation",
    "animation-delay",
    "opacity",
    "display",
    "width",
    "grid-area",
];

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

describe("MotionUI.css", () => {
    const root = postcss.parse(read(MOTION));

    it("stops pulse, spin and shimmer animations when reduced motion is requested", () => {
        const stopped: string[] = [];
        root.walkRules((rule) => {
            const media = rule.parent;
            if (
                media?.type !== "atrule" ||
                !(media as postcss.AtRule).params.includes(
                    "prefers-reduced-motion: reduce",
                )
            )
                return;
            let stops = false;
            rule.walkDecls("animation", (decl) => {
                if (decl.value === "none") stops = true;
            });
            if (stops) stopped.push(...rule.selectors);
        });
        expect(stopped).toEqual(
            expect.arrayContaining([
                ".animate-pulse",
                ".animate-spin",
                ".theme-shimmer",
                '[class*="animate-[shimmer"]',
            ]),
        );
    });

    it("stops every animation it defines under reduced motion", () => {
        // W26 moved the app's hand-written keyframes and the classes that run
        // them into this file, so it now holds animation utilities as well as
        // the reduced-motion overrides. Each utility must have a reduced-motion
        // rule that stops it, or a reduced-motion user keeps that motion.
        const animated = new Set<string>();
        root.walkRules((rule) => {
            // Skip keyframe steps and rules already inside an @media.
            if (rule.parent?.type === "atrule") return;
            rule.walkDecls("animation", (decl) => {
                if (decl.value.trim().startsWith("none")) return;
                for (const selector of rule.selectors) animated.add(selector);
            });
        });

        const stopped = new Set<string>();
        root.walkAtRules("media", (media) => {
            if (!media.params.includes("prefers-reduced-motion: reduce")) return;
            media.walkRules((rule) => {
                let stops = false;
                rule.walkDecls("animation", (decl) => {
                    if (decl.value.trim() === "none") stops = true;
                });
                if (stops) for (const selector of rule.selectors) stopped.add(selector);
            });
        });

        expect(animated.size).toBeGreaterThan(0);
        for (const selector of animated) {
            expect(
                stopped.has(selector),
                `${selector} keeps animating under reduced motion`,
            ).toBe(true);
        }
    });

    it("declares nothing outside the reduced-motion query but its keyframes and the utilities that run them", () => {
        // This file sits in the utilities layer after Tailwind's own, so an
        // unconditional rule here outranks every utility of the same
        // specificity. Before W26 the file held the reduced-motion query and
        // nothing else, and this test said so. It now also holds the
        // keyframes and animation utilities that moved in from globals.css,
        // and nothing more: any other rule (a restyled `.animate-spin`, a
        // stray declaration) belongs in a components-layer stylesheet.
        root.walkAtRules((rule) => {
            if (rule.parent?.type !== "root") {
                throw new Error(`@${rule.name} is nested in MotionUI.css`);
            }
            if (rule.name === "keyframes") return;
            expect(`@${rule.name} ${rule.params}`).toBe(
                `@media ${REDUCED_MOTION_QUERY}`,
            );
        });

        const unconditional: postcss.Rule[] = [];
        root.walkRules((rule) => {
            const parent = rule.parent;
            if (parent?.type === "atrule") {
                // A keyframe step, or a rule of the reduced-motion query.
                expect(["keyframes", "media"]).toContain(
                    (parent as postcss.AtRule).name,
                );
                return;
            }
            unconditional.push(rule);
        });

        expect(
            [...new Set(unconditional.flatMap((rule) => rule.selectors))].sort(),
        ).toEqual([...MOTION_UTILITIES].sort());
        for (const rule of unconditional) {
            rule.walkDecls((decl) => {
                expect(
                    MOTION_UTILITY_PROPERTIES,
                    `${rule.selector} declares ${decl.prop}`,
                ).toContain(decl.prop);
            });
        }
    });
});
