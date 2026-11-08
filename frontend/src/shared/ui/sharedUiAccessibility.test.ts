// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// Static accessibility guards for the shared primitives:
//  - no text smaller than 11px in shared/ui;
//  - the keyboard focus ring declares a forced-colors outline;
//  - the table checkbox box is at least 14px and its 24x24-target exemption is
//    documented (WCAG 2.5.8 spacing exception).

const frontend = process.cwd();
const SHARED_UI = resolve(frontend, "src/shared/ui");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
            ? [path]
            : [];
    });
}

/** Font-size, in px, of a `text-[Npx]` / `text-[Nrem]` arbitrary utility. */
function arbitraryTextPx(token: string): number | null {
    const px = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(token);
    if (px) return parseFloat(px[1]);
    const rem = /^text-\[(\d+(?:\.\d+)?)rem\]$/.exec(token);
    if (rem) return parseFloat(rem[1]) * 16;
    return null;
}

describe("shared/ui accessibility", () => {
    it("has no text smaller than 11px", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SHARED_UI)) {
            const source = readFileSync(file, "utf8");
            for (const match of source.matchAll(/text-\[[^\]]+\]/g)) {
                const px = arbitraryTextPx(match[0]);
                if (px !== null && px < 11)
                    offenders.push(`${relative(frontend, file)}: ${match[0]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("declares a forced-colors outline for the keyboard focus ring", () => {
        const css = readFileSync(resolve(SHARED_UI, "ThemeTokensUI.css"), "utf8");
        let found = false;
        postcss.parse(css).walkAtRules("media", (media) => {
            if (!/forced-colors:\s*active/.test(media.params)) return;
            media.walkRules((rule) => {
                if (!rule.selector.includes(":focus-visible")) return;
                rule.walkDecls("outline", () => {
                    found = true;
                });
            });
        });
        expect(found).toBe(true);
    });

    it("gives the table checkbox a box of at least 14px with a documented exception", () => {
        const table = readFileSync(
            resolve(frontend, "src/app/components/shared/TablePrimitive.tsx"),
            "utf8",
        );
        // Assert the constant's value carries a >= 14px box (h-3.5 / w-3.5) and
        // not the old 10px box (h-2.5).
        const value = /TABLE_CHECKBOX_CLASS\s*=\s*\n?\s*"([^"]+)"/.exec(table);
        expect(value, "TABLE_CHECKBOX_CLASS not found").toBeTruthy();
        expect(value?.[1]).toContain("h-3.5");
        expect(value?.[1]).toContain("w-3.5");
        expect(value?.[1]).not.toMatch(/\bh-2\.5\b/);

        const docs = readFileSync(
            resolve(frontend, "../docs/design-system.md"),
            "utf8",
        );
        expect(docs).toMatch(/2\.5\.8/);
        expect(docs.toLowerCase()).toContain("spacing exception");
    });
});
