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
    });
});

describe("MotionUI.css reduced motion", () => {
    const motionCss = read(MOTION);
    const motionRoot = postcss.parse(motionCss);

    // The reduced-motion block, as text.
    let reducedBlock = "";
    motionRoot.walkAtRules("media", (media) => {
        if (media.params.includes("prefers-reduced-motion: reduce")) {
            reducedBlock += media.toString();
        }
    });

    // Every keyframe declared anywhere in frontend/src, and the class selectors
    // that run it (so the test can find the rule that stops it).
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
            if (rule.parent?.type === "atrule") return;
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
        expect(reducedBlock).toContain("prefers-reduced-motion: reduce");
        expect(keyframeNames.size).toBeGreaterThan(0);
    });

    it("neutralises every @keyframes in frontend/src", () => {
        for (const name of keyframeNames) {
            const bySelector = (runningSelectors.get(name) ?? []).some((sel) =>
                reducedBlock.includes(sel),
            );
            const byName = reducedBlock.includes(name);
            expect(
                bySelector || byName,
                `MotionUI.css has no reduced-motion rule for @keyframes ${name}`,
            ).toBe(true);
        }
    });

    it("neutralises the tw-animate enter/exit translate and scale variables", () => {
        for (const variable of [
            "--tw-enter-translate-x",
            "--tw-enter-translate-y",
            "--tw-exit-translate-x",
            "--tw-exit-translate-y",
            "--tw-enter-scale",
            "--tw-exit-scale",
        ]) {
            expect(reducedBlock).toContain(variable);
        }
    });
});
