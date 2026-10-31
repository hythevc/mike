// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// globals.css maps Tailwind palette classes to dark values (the "dark palette
// map"). It lives in the utilities layer and scopes each rule with
// `:where(.dark)`, so a rule has exactly the specificity of the utility it
// maps and any more specific utility on the element (a hover:, focus: or dark:
// variant) wins. That only works if every variant of a mapped class has a
// dark value too; otherwise a hover paints its light value on a dark surface.
// These tests pin all three parts: the layer, the scoping and the coverage.

const frontendRoot = process.cwd();
const GLOBALS = resolve(frontendRoot, "src/app/globals.css");
const SCOPE = ":where(.dark) ";

const root = postcss.parse(readFileSync(GLOBALS, "utf8"));

/** Name of the nearest enclosing `@layer` block, or null when unlayered. */
function layerOf(node: postcss.Node): string | null {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === "atrule" && (parent as postcss.AtRule).name === "layer")
            return (parent as postcss.AtRule).params;
    }
    return null;
}

const darkRules: postcss.Rule[] = [];
root.walkRules((rule) => {
    if (/\.dark\b/.test(rule.selector)) darkRules.push(rule);
});

/**
 * Unlayered `.dark` rules that are not part of the map. The table-surface
 * sticky cell must stay unlayered to keep its opaque backing over utilities,
 * so its dark tint has to be unlayered and more specific too.
 */
const UNLAYERED_DARK_RULES = [".dark .table-surface .table-sticky-cell.bg-blue-50"];

/**
 * Element defaults that keep the full `.dark` specificity on purpose: they dim
 * the light-theme `placeholder:` utilities, which are one class strong.
 */
const ELEMENT_DEFAULTS = [".dark input::placeholder", ".dark textarea::placeholder"];

const mapRules = darkRules.filter(
    (rule) => !UNLAYERED_DARK_RULES.includes(rule.selector),
);
const mapSelectors = mapRules.flatMap((rule) => rule.selectors);
const classSelectors = mapSelectors.filter(
    (selector) => selector.startsWith(`${SCOPE}.`),
);

const unescape = (value: string) => value.replace(/\\(.)/g, "$1");

/** The utility class a scoped selector maps, e.g. `hover:text-gray-800`. */
function mappedClass(selector: string): string {
    const match = /^\.((?:\\.|[^\s:[>.,\\])+)/.exec(selector.slice(SCOPE.length));
    if (!match) throw new Error(`No class in ${selector}`);
    return unescape(match[1]);
}

const mappedClasses = new Set(classSelectors.map(mappedClass));
const baseClasses = new Set(
    [...mappedClasses].filter((name) => !name.includes(":")),
);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
            ? [path]
            : [];
    });
}

// One Tailwind variant: a name, a name with an arbitrary value such as
// `data-[selected=true]`, or an arbitrary selector such as `[&_button]`.
const VARIANT = String.raw`(?:[a-z0-9-]+(?:-\[[^\]\s"'\`]+\])?|\[[^\]\s"'\`]+\])`;
const VARIANT_TOKEN = new RegExp(
    String.raw`(?<![\w-])((?:${VARIANT}:)+)([a-z]+-[a-z0-9-]+(?:\/\d+)?)(?![\w/-])`,
    "g",
);

describe("dark palette map", () => {
    it("sits in the utilities layer, with no unlayered palette rules", () => {
        // A vacuous parse would pass every check below.
        expect(mapRules.length).toBeGreaterThan(40);
        expect(baseClasses).toContain("bg-white");
        expect(baseClasses).toContain("text-gray-500");
        for (const rule of mapRules) {
            expect({ selector: rule.selector, layer: layerOf(rule) }).toEqual({
                selector: rule.selector,
                layer: "utilities",
            });
        }
        for (const selector of UNLAYERED_DARK_RULES) {
            const rule = darkRules.find((item) => item.selector === selector);
            expect(rule && layerOf(rule)).toBeNull();
        }
    });

    it("scopes every class rule with :where(.dark), so variants on the element still win", () => {
        const unscoped = mapSelectors.filter(
            (selector) =>
                !selector.startsWith(SCOPE) &&
                !ELEMENT_DEFAULTS.includes(selector),
        );
        expect(unscoped).toEqual([]);
    });

    it("matches the selectors Tailwind generates for each mapped class", async () => {
        // A typo in a hand-escaped selector would leave its rule matching
        // nothing. Generate every mapped class and compare.
        const candidates = [...mappedClasses];
        const input = [
            `@import "tailwindcss" source(none);`,
            `@import "../shared/ui/DesignTokensUI.css";`,
            ...candidates.map((name) => `@source inline(${JSON.stringify(name)});`),
        ].join("\n");
        const { css } = await postcss([
            tailwindcss({ base: resolve(frontendRoot, "src/app") }),
        ]).process(input, { from: GLOBALS });
        const generated = new Set<string>();
        postcss.parse(css).walkRules((rule) => {
            for (const selector of rule.selectors) {
                // `divide-*` utilities wrap their whole selector in :where().
                const unwrapped = /^:where\((.*)\)$/.exec(selector);
                generated.add(unwrapped ? unwrapped[1] : selector);
            }
        });
        const unmatched = classSelectors.filter(
            (selector) => !generated.has(selector.slice(SCOPE.length)),
        );
        expect(unmatched).toEqual([]);
    });

    it("gives every variant of a mapped class that the source uses a dark value", () => {
        const missing = new Map<string, string>();
        for (const file of sourceFiles(resolve(frontendRoot, "src"))) {
            const source = readFileSync(file, "utf8");
            for (const match of source.matchAll(VARIANT_TOKEN)) {
                const [token, variants, utility] = match;
                if (!baseClasses.has(utility)) continue;
                const chain = variants.split(":").filter(Boolean);
                // An explicit `dark:` utility is already the dark value, and
                // `placeholder:` is covered by the element default above.
                if (chain.includes("dark") || chain[0] === "placeholder") continue;
                if (!mappedClasses.has(token) && !missing.has(token))
                    missing.set(token, relative(frontendRoot, file));
            }
        }
        expect(Object.fromEntries(missing)).toEqual({});
    });
});
