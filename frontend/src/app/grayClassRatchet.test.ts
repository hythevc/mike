// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Raw Tailwind gray-* utilities are the muted colours that predate the semantic
// tokens. W11 added the tokens and a light-theme bridge so existing grays are
// legible, and migrates the primitives; screens follow later. This ratchet
// makes that one-way: the number of raw gray-* uses in component source may
// only fall. Lower `max` in grayClassRatchet.json in the change that removes
// them. The colours themselves are guarded by tokenContrast.test.ts and e2e
// axe; this guards the drift back to raw palette values.

const frontend = process.cwd();
const SRC = resolve(frontend, "src");
const GRAY = /gray-(?:50|100|200|300|400|500|600|700|800|900|950)/g;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
            ? [path]
            : [];
    });
}

function grayCount(): number {
    let total = 0;
    for (const file of sourceFiles(SRC)) {
        const matches = readFileSync(file, "utf8").match(GRAY);
        total += matches ? matches.length : 0;
    }
    return total;
}

const { max } = JSON.parse(
    readFileSync(resolve(SRC, "app/grayClassRatchet.json"), "utf8"),
) as { max: number };

describe("raw gray-* ratchet", () => {
    it("does not rise above the recorded count", () => {
        const count = grayCount();
        if (count < max) {
            // Not a failure: the migration advanced. Record the lower number.
            console.log(
                `[gray-ratchet] ${count} raw gray-* uses (recorded ${max}). ` +
                    `Lower "max" in src/app/grayClassRatchet.json to ${count}.`,
            );
        }
        expect(count).toBeLessThanOrEqual(max);
    });
});
