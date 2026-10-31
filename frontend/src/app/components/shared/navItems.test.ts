// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemCurrent, type NavItem } from "./navItems";

const item = (href: string): NavItem => {
    const found = NAV_ITEMS.find((entry) => entry.href === href);
    if (!found) throw new Error(`No nav item for ${href}`);
    return found;
};

describe("NAV_ITEMS", () => {
    it("lists each destination once, in sidebar order", () => {
        expect(NAV_ITEMS.map((entry) => entry.href)).toEqual([
            "/assistant",
            "/ide",
            "/projects",
            "/library",
            "/tabular-reviews",
            "/workflows",
            "/playbooks",
        ]);
    });
});

describe("isNavItemCurrent", () => {
    it("matches an item on its own path", () => {
        for (const entry of NAV_ITEMS) {
            expect(isNavItemCurrent(entry, entry.href)).toBe(true);
        }
    });

    it("matches the pages below an item unless it is exact", () => {
        expect(isNavItemCurrent(item("/library"), "/library/folder-1")).toBe(true);
        expect(
            isNavItemCurrent(item("/workflows"), "/workflows/tabular-review/w-1"),
        ).toBe(true);
        expect(isNavItemCurrent(item("/assistant"), "/assistant/chat/c-1")).toBe(
            false,
        );
        expect(isNavItemCurrent(item("/projects"), "/projects/p-1")).toBe(false);
    });

    it("does not match a different path that shares a prefix", () => {
        expect(isNavItemCurrent(item("/library"), "/library-archive")).toBe(false);
        expect(isNavItemCurrent(item("/playbooks"), "/playbooksx")).toBe(false);
    });
});
