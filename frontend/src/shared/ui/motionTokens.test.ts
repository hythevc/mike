// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

/*
 * Motion tokens (W26). The easings live under Tailwind's `--ease-*` theme
 * namespace so `ease-out-strong` and friends compile as utilities; the
 * durations are named custom properties on :root. This pins the set and the
 * budget (≤ 300ms, exits quicker than entrances), and checks MotionUI.css
 * carries a reduced-motion escape for every keyframe and for tw-animate's
 * enter/exit variables. See docs/design-system.md → Motion.
 */

const SRC = resolve(process.cwd(), "src");
const TOKENS = resolve(SRC, "shared/ui/DesignTokensUI.css");
const MOTION = resolve(SRC, "shared/ui/MotionUI.css");

const read = (path: string) => readFileSync(path, "utf8");

function cssFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return ["node_modules", ".next", "dist", "coverage"].includes(
                entry.name,
            )
                ? []
                : cssFiles(path);
        }
        return entry.name.endsWith(".css") ? [path] : [];
    });
}

const tokensCss = read(TOKENS);
const tokensRoot = postcss.parse(tokensCss);

/** name -> { value, atRule } for every custom property in DesignTokensUI.css. */
const tokenDecls = new Map<string, { value: string; atRule?: string }>();
tokensRoot.walkDecls(/^--/, (decl) => {
    const parent = decl.parent;
    const atRule =
        parent?.type === "atrule" ? (parent as postcss.AtRule).name : undefined;
    tokenDecls.set(decl.prop, { value: decl.value, atRule });
});

/** Resolve a duration (`80ms`, `0.3s`, or `var(--motion-duration-base)`) to ms. */
function durationMs(value: string): number {
    const trimmed = value.trim();
    const varMatch = trimmed.match(/^var\((--[\w-]+)\)$/);
    if (varMatch) {
        const target = tokenDecls.get(varMatch[1]);
        if (!target) throw new Error(`unknown token ${varMatch[1]}`);
        return durationMs(target.value);
    }
    if (trimmed.endsWith("ms")) return parseFloat(trimmed);
    if (trimmed.endsWith("s")) return parseFloat(trimmed) * 1000;
    throw new Error(`not a duration: ${value}`);
}

describe("motion tokens", () => {
    it("declares the easings under @theme so the utilities compile", () => {
        for (const name of [
            "--ease-out-strong",
            "--ease-out-soft",
            "--ease-in-out-soft",
        ]) {
            const decl = tokenDecls.get(name);
            expect(decl, `${name} is declared`).toBeDefined();
            expect(decl?.atRule, `${name} sits under @theme`).toBe("theme");
            expect(decl?.value).toMatch(/^cubic-bezier\(/);
        }
    });

    it("names the four duration tiers plus enter/exit, all ≤ 300ms", () => {
        const names = [...tokenDecls.keys()].filter((n) =>
            n.startsWith("--motion-duration-"),
        );
        expect(new Set(names)).toEqual(
            new Set([
                "--motion-duration-instant",
                "--motion-duration-fast",
                "--motion-duration-base",
                "--motion-duration-slow",
                "--motion-duration-enter",
                "--motion-duration-exit",
            ]),
        );
        for (const name of names) {
            expect(durationMs(tokenDecls.get(name)!.value)).toBeLessThanOrEqual(
                300,
            );
        }
    });

    it("orders the tiers and keeps every exit quicker than its entrance", () => {
        const ms = (n: string) => durationMs(tokenDecls.get(n)!.value);
        expect(ms("--motion-duration-instant")).toBeLessThan(
            ms("--motion-duration-fast"),
        );
        expect(ms("--motion-duration-fast")).toBeLessThan(
            ms("--motion-duration-base"),
        );
        expect(ms("--motion-duration-base")).toBeLessThan(
            ms("--motion-duration-slow"),
        );
        // The exit alias is strictly quicker than the entrance alias, so a
        // dismissal never outstays the content it closes.
        expect(ms("--motion-duration-exit")).toBeLessThan(
            ms("--motion-duration-enter"),
        );
        // `instant` is the press of a frequent control: over before the
        // pointer lifts.
        expect(ms("--motion-duration-instant")).toBeLessThanOrEqual(80);
    });
});

describe("MotionUI.css reduced motion", () => {
    const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
    const isReducedMotion = (node: postcss.Container | postcss.Document | undefined) =>
        node?.type === "atrule" &&
        (node as postcss.AtRule).name === "media" &&
        (node as postcss.AtRule).params === REDUCED_MOTION;
    const isKeyframes = (node: postcss.Container | postcss.Document | undefined) =>
        node?.type === "atrule" && (node as postcss.AtRule).name === "keyframes";

    const motionRoot = postcss.parse(read(MOTION));

    // The rules of the reduced-motion block, parsed: comments are not rules,
    // and a selector is matched whole, so `.sidebar-fade-in-2` does not stand
    // in for `.sidebar-fade-in`, nor a word in a comment for a keyframe.
    const reducedRules: postcss.Rule[] = [];
    motionRoot.walkAtRules("media", (media) => {
        if (!isReducedMotion(media)) return;
        media.walkRules((rule) => {
            reducedRules.push(rule);
        });
    });
    /** Selectors whose reduced-motion rule declares `animation: none`. */
    const stopped = new Set<string>();
    for (const rule of reducedRules) {
        let stops = false;
        rule.walkDecls("animation", (decl) => {
            if (decl.value.trim() === "none") stops = true;
        });
        if (stops) for (const selector of rule.selectors) stopped.add(selector);
    }

    // Every keyframe declared anywhere in frontend/src, and the selectors of
    // the CSS rules that run it, at any depth (inside `@layer` too). Rules in
    // a reduced-motion block and keyframe steps are not runners.
    const keyframeNames = new Set<string>();
    const runningSelectors = new Map<string, string[]>();
    const allCss = cssFiles(SRC).map((path) => postcss.parse(read(path)));
    for (const root of allCss) {
        root.walkAtRules("keyframes", (kf) => {
            keyframeNames.add(kf.params);
        });
    }
    for (const root of allCss) {
        root.walkRules((rule) => {
            if (isKeyframes(rule.parent) || isReducedMotion(rule.parent)) return;
            rule.walkDecls(/^animation(-name)?$/, (decl) => {
                for (const name of keyframeNames) {
                    if (new RegExp(`\\b${name}\\b`).test(decl.value)) {
                        const list = runningSelectors.get(name) ?? [];
                        list.push(...rule.selectors);
                        runningSelectors.set(name, list);
                    }
                }
            });
        });
    }

    it("has a reduced-motion block", () => {
        expect(reducedRules.length).toBeGreaterThan(0);
        expect(stopped.size).toBeGreaterThan(0);
        expect(keyframeNames.size).toBeGreaterThan(0);
    });

    it("neutralises every @keyframes in frontend/src", () => {
        for (const name of keyframeNames) {
            // Each CSS rule that runs the keyframe is stopped by a rule with
            // the same selector...
            const runners = runningSelectors.get(name) ?? [];
            expect(
                runners.filter((selector) => !stopped.has(selector)),
                `these run @keyframes ${name} and are not stopped under reduced motion`,
            ).toEqual([]);
            // ...and a keyframe no CSS rule runs is one a Tailwind
            // `animate-[name …]` utility runs, stopped through its own
            // attribute selector.
            if (runners.length === 0) {
                expect(
                    stopped.has(`[class*="animate-[${name}"]`),
                    `MotionUI.css has no reduced-motion rule for @keyframes ${name}`,
                ).toBe(true);
            }
        }
    });

    it("stops the sidebar fades and the uploading ellipsis by their own selectors", () => {
        // The keyframes this item moved into MotionUI.css, by name, so the
        // loop above cannot pass by finding nothing to check.
        expect([...keyframeNames].sort()).toEqual(
            expect.arrayContaining([
                "shimmer",
                "sidebarFadeIn",
                "uploadingEllipsisOne",
                "uploadingEllipsisThree",
                "uploadingEllipsisTwo",
            ]),
        );
        expect(runningSelectors.get("sidebarFadeIn")?.sort()).toEqual([
            ".sidebar-fade-in",
            ".sidebar-fade-in-2",
            ".sidebar-heading-enter",
        ]);
        for (const selector of [
            ".sidebar-fade-in",
            ".sidebar-fade-in-2",
            ".sidebar-heading-enter",
            ".uploading-ellipsis-one",
            ".uploading-ellipsis-two",
            ".uploading-ellipsis-three",
        ]) {
            expect(stopped.has(selector), selector).toBe(true);
        }
    });

    it("neutralises the tw-animate enter/exit translate and scale variables", () => {
        // One rule, on every element that runs a tw-animate entrance or exit,
        // sets each channel to its resting value. `!important`, because the
        // per-side slide utilities carry a class and an attribute selector.
        const rule = reducedRules.find(
            (candidate) =>
                candidate.selectors.includes('[class*="animate-in"]') &&
                candidate.selectors.includes('[class*="animate-out"]'),
        );
        expect(rule, "no reduced-motion rule for tw-animate surfaces").toBeDefined();
        const declared = new Map<string, postcss.Declaration>();
        rule?.walkDecls((decl) => {
            declared.set(decl.prop, decl);
        });
        for (const [variable, resting] of [
            ["--tw-enter-translate-x", "0"],
            ["--tw-enter-translate-y", "0"],
            ["--tw-exit-translate-x", "0"],
            ["--tw-exit-translate-y", "0"],
            ["--tw-enter-scale", "1"],
            ["--tw-exit-scale", "1"],
        ]) {
            expect(declared.get(variable)?.value, variable).toBe(resting);
            expect(declared.get(variable)?.important, variable).toBe(true);
        }
        // The fade is the gentler motion that stays: opacity is left alone.
        expect(declared.has("--tw-enter-opacity")).toBe(false);
        expect(declared.has("--tw-exit-opacity")).toBe(false);
    });
});
