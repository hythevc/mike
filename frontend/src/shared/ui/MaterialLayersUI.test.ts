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

    it("declares no rule outside the reduced-motion query", () => {
        root.walkRules((rule) => {
            expect((rule.parent as postcss.AtRule | undefined)?.name).toBe(
                "media",
            );
        });
    });
});
