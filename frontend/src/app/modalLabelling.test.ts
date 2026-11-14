// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every dialog needs an accessible name. `ModalUI` and the `Modal` wrapper take
// a `title` (rendered as a heading and wired to aria-labelledby), fall back to
// `breadcrumbs` (the last crumb names the dialog) and then to a plain
// `ariaLabel`. This ratchet counts the `<Modal>` / `<ModalUI>` call sites that
// pass none of the three, per file, and lets the count only fall: a new
// unlabelled dialog fails the build, and W29 removes its screens' entries as it
// labels them.

const frontend = process.cwd();
const SRC = resolve(frontend, "src");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx$/.test(entry.name) &&
            !/\.(test|stories)\.tsx$/.test(entry.name)
            ? [path]
            : [];
    });
}

/** The text of a JSX opening tag starting at `start`, brace- and string-aware. */
function readOpeningTag(source: string, start: number): string {
    let depth = 0;
    let quote: string | null = null;
    let i = start;
    for (; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) {
            i++;
            break;
        }
    }
    return source.slice(start, i);
}

/** Count `<Modal>` / `<ModalUI>` openings that name the dialog nowhere. */
function unlabelledCallSites(source: string): number {
    let count = 0;
    const re = /<(ModalUI|Modal)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        const tag = readOpeningTag(source, match.index);
        const named = /\b(title|ariaLabel|breadcrumbs)\s*=/.test(tag);
        // A spread may carry a name; do not count it as a bare dialog.
        const spread = /\{\s*\.\.\./.test(tag);
        if (!named && !spread) count += 1;
    }
    return count;
}

describe("modal labelling ratchet", () => {
    it("adds no unlabelled dialog beyond the recorded allowlist", () => {
        const { allow } = JSON.parse(
            readFileSync(resolve(SRC, "app/modalLabelAllowlist.json"), "utf8"),
        ) as { allow: Record<string, number> };

        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const rel = relative(frontend, file);
            const found = unlabelledCallSites(readFileSync(file, "utf8"));
            const allowed = allow[rel] ?? 0;
            if (found > allowed) {
                offenders.push(
                    `${rel}: ${found} unlabelled dialog(s), allowlist permits ${allowed}. ` +
                        `Give the Modal/ModalUI a title, breadcrumbs or ariaLabel.`,
                );
            } else if (found < allowed) {
                // Not a failure: a dialog was labelled. Record the lower count.
                console.log(
                    `[modal-labelling] ${rel}: ${found} unlabelled (recorded ${allowed}); ` +
                        `lower it in modalLabelAllowlist.json.`,
                );
            }
        }
        expect(offenders).toEqual([]);
    });
});
