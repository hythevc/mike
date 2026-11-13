// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { brand } from "../brand.generated";

// The semantic colour roles in DesignTokensUI.css must clear WCAG 2.2 AA where
// it matters: muted body text on a surface (4.5:1), the focus ring against the
// surfaces it sits on (3:1), and on-brand text on the brand primary (4.5:1).
// This test resolves the tokens straight from the stylesheet — var() chains and
// all — with a self-contained OKLCH/hex/rgb -> sRGB helper (no new dependency),
// so a token edit that drops below the threshold fails here rather than only in
// a browser axe run.

const CSS = readFileSync(
    resolve(process.cwd(), "src/shared/ui/DesignTokensUI.css"),
    "utf8",
);

type Theme = "light" | "dark";

/** Custom properties declared directly under a selector (`:root` or `.dark`). */
function varsFor(selector: string): Map<string, string> {
    const vars = new Map<string, string>();
    postcss.parse(CSS).walkRules((rule) => {
        if (rule.selector !== selector) return;
        rule.walkDecls(/^--/, (decl) => {
            vars.set(decl.prop, decl.value.trim());
        });
    });
    return vars;
}

const rootVars = varsFor(":root");
const darkVars = varsFor(".dark");

/** The raw value of a custom property in a theme, dark falling back to root. */
function lookup(name: string, theme: Theme): string | undefined {
    if (theme === "dark" && darkVars.has(name)) return darkVars.get(name);
    return rootVars.get(name);
}

/** Splits `var()` arguments on the top-level comma, respecting nested parens. */
function splitTopLevel(input: string): [string, string | undefined] {
    let depth = 0;
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        else if (ch === "," && depth === 0)
            return [input.slice(0, i).trim(), input.slice(i + 1).trim()];
    }
    return [input.trim(), undefined];
}

/** Resolves a value to a concrete colour string, following var() references. */
function resolveValue(value: string, theme: Theme, depth = 0): string {
    if (depth > 20) throw new Error(`var() chain too deep: ${value}`);
    const trimmed = value.trim();
    const match = /^var\(([\s\S]*)\)$/.exec(trimmed);
    if (!match) return trimmed;
    const [name, fallback] = splitTopLevel(match[1]);
    const resolved = lookup(name, theme);
    if (resolved !== undefined) return resolveValue(resolved, theme, depth + 1);
    if (fallback !== undefined) return resolveValue(fallback, theme, depth + 1);
    throw new Error(`Unresolved ${name} (${theme})`);
}

// --- Colour maths: OKLCH / hex / rgb -> sRGB -> relative luminance ----------

type Rgb = [number, number, number]; // each 0-255

function hexToRgb(hex: string): Rgb {
    const value = hex.replace("#", "");
    const full =
        value.length === 3
            ? value
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : value.slice(0, 6);
    return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
    ];
}

function parseRgb(input: string): Rgb {
    const nums = input
        .slice(input.indexOf("(") + 1, input.lastIndexOf(")"))
        .split(/[,/\s]+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((part) =>
            part.endsWith("%")
                ? Math.round((parseFloat(part) / 100) * 255)
                : parseFloat(part),
        );
    return [nums[0], nums[1], nums[2]];
}

function clamp01(x: number): number {
    return Math.min(1, Math.max(0, x));
}

function linearToSrgb(c: number): number {
    const v = clamp01(c);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** oklch(L C H) with L either 0..1 or a percentage; returns 0-255 sRGB. */
function oklchToRgb(input: string): Rgb {
    const parts = input
        .slice(input.indexOf("(") + 1, input.lastIndexOf(")"))
        .split(/[,/\s]+/)
        .filter(Boolean);
    const L = parts[0].endsWith("%") ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const C = parseFloat(parts[1]);
    const H = parseFloat(parts[2] ?? "0");
    const a = C * Math.cos((H * Math.PI) / 180);
    const b = C * Math.sin((H * Math.PI) / 180);
    const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lr = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
    const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
    const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
    return [
        Math.round(linearToSrgb(lr) * 255),
        Math.round(linearToSrgb(lg) * 255),
        Math.round(linearToSrgb(lb) * 255),
    ];
}

function toRgb(color: string): Rgb {
    const value = color.trim();
    if (value.startsWith("#")) return hexToRgb(value);
    if (value.startsWith("oklch")) return oklchToRgb(value);
    if (value.startsWith("rgb")) return parseRgb(value);
    throw new Error(`Unsupported colour: ${color}`);
}

function relativeLuminance([r, g, b]: Rgb): number {
    const channel = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two concrete colour strings. */
function ratioBetween(a: string, b: string): number {
    const la = relativeLuminance(toRgb(a));
    const lb = relativeLuminance(toRgb(b));
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast ratio between two resolved token values in a theme. */
function contrast(aName: string, bName: string, theme: Theme): number {
    return ratioBetween(
        resolveValue(`var(${aName})`, theme),
        resolveValue(`var(${bName})`, theme),
    );
}

const THEMES: Theme[] = ["light", "dark"];
const SURFACES = ["--surface", "--surface-elevated", "--app-background"];
const TEXT_ROLES = ["--text-primary", "--text-secondary", "--text-muted"];

describe("DesignTokensUI semantic colour roles", () => {
    it("parses both themes (guards against a vacuous run)", () => {
        expect(rootVars.get("--text-muted")).toBeTruthy();
        expect(darkVars.get("--text-muted")).toBeTruthy();
        // The helper agrees with a known pair: black on white is 21:1.
        expect(relativeLuminance(hexToRgb("#ffffff"))).toBeCloseTo(1, 5);
        expect(relativeLuminance(hexToRgb("#000000"))).toBeCloseTo(0, 5);
    });

    for (const theme of THEMES) {
        for (const text of TEXT_ROLES) {
            for (const surface of SURFACES) {
                it(`${text} on ${surface} clears 4.5:1 (${theme})`, () => {
                    expect(contrast(text, surface, theme)).toBeGreaterThanOrEqual(4.5);
                });
            }
        }

        for (const surface of SURFACES) {
            it(`--focus-ring clears 3:1 against ${surface} (${theme})`, () => {
                expect(contrast("--focus-ring", surface, theme)).toBeGreaterThanOrEqual(3);
            });
        }

        it(`on-brand text clears 4.5:1 on the brand primary (${theme})`, () => {
            expect(
                contrast("--brand-on-primary-color", "--brand-primary-color", theme),
            ).toBeGreaterThanOrEqual(4.5);
        });
    }
});

// Brand-on-dark (W27). When the brand config carries palette.primaryDark,
// layout.tsx sets --brand-primary-dark and the dark brand fill resolves to it
// (not to the navy primary, which fails the 3:1 boundary against the dark
// surface). This block reads the generated brand value directly, because the
// stylesheet only holds the var() fallback, not the runtime brand value. It is
// guarded on the slot being set, matching "whenever the slot is set".
const primaryDark = brand.palette.primaryDark;
describe.runIf(primaryDark !== undefined)("brand fill on the dark surface", () => {
    it("on-brand text clears 4.5:1 on primaryDark", () => {
        expect(ratioBetween(brand.palette.onPrimary, primaryDark!)).toBeGreaterThanOrEqual(4.5);
    });

    it("the brand fill clears 3:1 against the dark --app-surface", () => {
        const surface = resolveValue("var(--app-surface)", "dark");
        expect(ratioBetween(primaryDark!, surface)).toBeGreaterThanOrEqual(3);
    });
});
