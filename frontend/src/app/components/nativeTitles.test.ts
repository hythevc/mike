// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// W28 replaces the browser's native `title` attribute — which never surfaces
// on keyboard focus — with the tooltip primitive on these icon-only controls
// and the quote marker. This test is the guard: none of the five files may
// carry a native `title` attribute on an intrinsic (lowercase-tag) element.
//
// A `title` PROP on a component (e.g. `<WarningPopup title=...>`, a dialog
// heading) is a different thing and is allowed; the scanner only flags
// lowercase host elements.
const FILES = [
    "shared/RowActions.tsx",
    "shared/TableToolbar.tsx",
    "shared/DocumentTabActions.tsx",
    "shared/ChatPanelHeader.tsx",
    "tabular/TabularQuoteMarker.tsx",
];

/** Tag names of host (lowercase) JSX elements that carry a `title` attribute. */
function nativeTitleTags(source: string): string[] {
    const hits: string[] = [];
    let i = 0;
    while (i < source.length) {
        const lt = source.indexOf("<", i);
        if (lt === -1) break;
        const name = /^<([A-Za-z][\w.]*)/.exec(source.slice(lt));
        if (!name) {
            i = lt + 1;
            continue;
        }
        const tag = name[1]!;
        // Read the opening tag's attributes, respecting quoted strings and
        // `{...}` expression braces, up to the matching `>` at depth 0.
        let j = lt + name[0].length;
        let attrs = "";
        let depth = 0;
        let quote: string | null = null;
        for (; j < source.length; j += 1) {
            const ch = source[j]!;
            if (quote) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'" || ch === "`") {
                quote = ch;
            } else if (ch === "{") {
                depth += 1;
            } else if (ch === "}") {
                depth -= 1;
            } else if (ch === ">" && depth === 0) {
                break;
            }
            attrs += ch;
        }
        if (/^[a-z]/.test(tag) && /(^|\s)title\s*=/.test(attrs)) {
            hits.push(tag);
        }
        i = j + 1;
    }
    return hits;
}

describe("no native title attributes on the tooltip-migrated controls", () => {
    it.each(FILES)("%s carries no native title attribute", (relative) => {
        const source = readFileSync(
            resolve(__dirname, relative),
            "utf8",
        );
        expect(nativeTitleTags(source)).toEqual([]);
    });

    it("keeps the icon-only controls' accessible names", () => {
        const read = (relative: string) =>
            readFileSync(resolve(__dirname, relative), "utf8");
        // The names that previously doubled as native titles now live only as
        // the accessible name, so they must not have been dropped.
        expect(read("shared/TableToolbar.tsx")).toContain(
            'aria-label="Toolbar actions"',
        );
        expect(read("shared/ChatPanelHeader.tsx")).toContain(
            'aria-label="Close chat panel"',
        );
        expect(read("shared/RowActions.tsx")).toContain("aria-label={ariaLabel}");
    });
});
