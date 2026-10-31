// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { focusNeighbour } from "./focusNeighbour";

/** A list of rows, each an icon and a title button, like the sidebar's. */
function list(titles: string[], containerTabIndex?: number) {
    const container = document.createElement("div");
    if (containerTabIndex !== undefined) {
        container.tabIndex = containerTabIndex;
    }
    const rows = document.createElement("div");
    for (const title of titles) {
        const row = document.createElement("div");
        row.innerHTML = `<span aria-hidden="true"></span><button type="button">${title}</button><button type="button" aria-label="Actions for ${title}"></button>`;
        rows.appendChild(row);
    }
    container.appendChild(rows);
    document.body.appendChild(container);
    return { container, rows: [...rows.children] as HTMLElement[] };
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("focusNeighbour", () => {
    it("moves focus to the next item's first control", () => {
        const { rows } = list(["Filing", "Lease", "Merger"]);

        expect(focusNeighbour(rows[1])).toBe(true);

        expect(document.activeElement).toHaveTextContent("Merger");
    });

    it("moves focus to the previous item when the item is last", () => {
        const { rows } = list(["Filing", "Lease"]);

        expect(focusNeighbour(rows[1])).toBe(true);

        expect(document.activeElement).toHaveTextContent("Filing");
    });

    it("takes an item that is itself a link", () => {
        const { rows } = list(["Filing"]);
        const link = document.createElement("a");
        link.href = "/tabular-reviews/review-1";
        link.textContent = "Review";
        rows[0].after(link);

        focusNeighbour(rows[0]);

        expect(document.activeElement).toBe(link);
    });

    it("passes over an item with nothing to focus", () => {
        const { rows } = list(["Filing", "Lease", "Merger"]);
        for (const button of rows[2].querySelectorAll("button")) {
            button.disabled = true;
        }

        focusNeighbour(rows[1]);

        expect(document.activeElement).toHaveTextContent("Filing");
    });

    it("falls back to a container that can take focus when the list empties", () => {
        const { container, rows } = list(["Filing"], -1);

        expect(focusNeighbour(rows[0])).toBe(true);

        expect(document.activeElement).toBe(container);
    });

    it("leaves focus alone when there is nowhere to go", () => {
        const { rows } = list(["Filing"]);
        const title = rows[0].querySelector("button")!;
        title.focus();

        expect(focusNeighbour(rows[0])).toBe(false);
        expect(focusNeighbour(document.createElement("div"))).toBe(false);
        expect(focusNeighbour(null)).toBe(false);

        expect(document.activeElement).toBe(title);
    });
});
