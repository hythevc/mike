// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildCommandMenu, type CommandGroupId } from "./commandMenuItems";

function group(
    result: ReturnType<typeof buildCommandMenu>,
    id: CommandGroupId,
) {
    return result.groups.find((entry) => entry.id === id);
}

const recents = {
    chats: [{ id: "c1", title: "Lease questions", updated_at: "2026-01-01T00:00:00Z" }],
    projects: [{ id: "p1", name: "Acme merger", updated_at: "2026-03-01T00:00:00Z" }],
    reviews: [{ id: "r1", name: "NDA batch", updated_at: "2026-02-01T00:00:00Z" }],
};

describe("buildCommandMenu", () => {
    it("groups Go to, Recent and Actions", () => {
        const result = buildCommandMenu({
            query: "",
            inOrganization: false,
            recents,
        });
        expect(result.groups.map((g) => g.id)).toEqual([
            "goto",
            "recent",
            "actions",
        ]);
        expect(group(result, "goto")?.label).toBe("Go to");
        expect(group(result, "recent")?.label).toBe("Recent");
        expect(group(result, "actions")?.label).toBe("Actions");
    });

    it("includes navigation items and settings entries under Go to", () => {
        const goto = group(
            buildCommandMenu({ query: "", inOrganization: true }),
            "goto",
        )!;
        const hrefs = goto.items.map((item) => item.href);
        expect(hrefs).toContain("/assistant");
        expect(hrefs).toContain("/projects");
        expect(hrefs.some((href) => href?.startsWith("/settings"))).toBe(true);
    });

    it("shows Intake only in an organization workspace", () => {
        const hrefs = (inOrganization: boolean) =>
            group(buildCommandMenu({ query: "", inOrganization }), "goto")!.items.map(
                (item) => item.href,
            );
        expect(hrefs(false)).not.toContain("/intake");
        expect(hrefs(true)).toContain("/intake");
    });

    it("lists recent chats, projects and reviews newest first", () => {
        const recent = group(
            buildCommandMenu({ query: "", inOrganization: false, recents }),
            "recent",
        )!;
        expect(recent.items.map((item) => item.label)).toEqual([
            "Acme merger",
            "NDA batch",
            "Lease questions",
        ]);
    });

    it("gives every Go to and Recent destination an href", () => {
        const result = buildCommandMenu({
            query: "",
            inOrganization: true,
            recents,
        });
        for (const entry of result.groups) {
            if (entry.id === "actions") continue;
            for (const item of entry.items) {
                expect(typeof item.href).toBe("string");
            }
        }
    });

    it("keeps the current ?side= value on an assistant destination only", () => {
        const result = buildCommandMenu({
            query: "",
            inOrganization: false,
            currentSearch: "?side=abc",
            recents,
        });
        const chat = group(result, "recent")!.items.find(
            (item) => item.id === "chat:c1",
        )!;
        expect(chat.href).toBe("/assistant/chat/c1?side=abc");
        const project = group(result, "recent")!.items.find(
            (item) => item.id === "project:p1",
        )!;
        expect(project.href).toBe("/projects/p1");
    });

    it("filters case- and accent-insensitively", () => {
        const upper = buildCommandMenu({ query: "PROJECTS", inOrganization: false });
        expect(
            upper.groups
                .flatMap((g) => g.items)
                .some((item) => item.href === "/projects"),
        ).toBe(true);

        const accent = buildCommandMenu({
            query: "resume",
            inOrganization: false,
            recents: {
                projects: [
                    { id: "p", name: "Résumé review", updated_at: "2026-01-01T00:00:00Z" },
                ],
            },
        });
        expect(
            group(accent, "recent")?.items.map((item) => item.label),
        ).toContain("Résumé review");
    });

    it("surfaces an action by its keywords", () => {
        const result = buildCommandMenu({ query: "collapse", inOrganization: false });
        const actions = group(result, "actions")!;
        expect(actions.items.map((item) => item.label)).toEqual([
            "Toggle sidebar",
        ]);
        expect(actions.items[0]!.action).toBe("toggle-sidebar");
        expect(actions.items[0]!.href).toBeUndefined();
    });

    it("returns the No matches state when nothing matches", () => {
        const result = buildCommandMenu({
            query: "zzqnothingmatchesthis",
            inOrganization: true,
            recents,
        });
        expect(result.isEmpty).toBe(true);
        expect(result.total).toBe(0);
        expect(result.groups).toEqual([]);
    });
});
