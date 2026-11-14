// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HEADING_SIZE_CLASSES, HeadingUI, type HeadingUISize } from "./HeadingUI";

describe("HeadingUI", () => {
    it("renders its children", () => {
        render(<HeadingUI size="page">Projects</HeadingUI>);
        expect(screen.getByText("Projects")).toBeInTheDocument();
    });

    it("defaults each size to a sensible heading level", () => {
        render(
            <>
                <HeadingUI size="settings">Settings</HeadingUI>
                <HeadingUI size="section">Section</HeadingUI>
            </>,
        );
        expect(
            screen.getByRole("heading", { name: "Settings", level: 1 }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: "Section", level: 2 }),
        ).toBeInTheDocument();
    });

    it("honours an explicit element, including a non-heading one", () => {
        render(
            <HeadingUI size="display" as="p">
                Nothing yet
            </HeadingUI>,
        );
        // `as="p"` keeps the display style without adding to the outline.
        expect(screen.queryByRole("heading")).toBeNull();
        expect(screen.getByText("Nothing yet")).toHaveClass(
            "font-serif",
            "text-2xl",
            "font-medium",
        );
    });

    it("applies each size's documented classes and the fg colour role", () => {
        const sizes: HeadingUISize[] = [
            "settings",
            "display",
            "page",
            "section",
            "label",
        ];
        for (const size of sizes) {
            const { unmount } = render(
                <HeadingUI size={size} as="span">
                    {size}
                </HeadingUI>,
            );
            const node = screen.getByText(size);
            for (const token of HEADING_SIZE_CLASSES[size].split(" ")) {
                expect(node).toHaveClass(token);
            }
            expect(node).toHaveClass("text-fg");
            unmount();
        }
    });

    it("switches to the danger role without a raw colour", () => {
        render(
            <HeadingUI size="section" tone="danger">
                Delete account
            </HeadingUI>,
        );
        const node = screen.getByText("Delete account");
        expect(node).toHaveClass("text-danger");
        expect(node).not.toHaveClass("text-fg");
    });

    it("keeps the page size equal to the shared page-title recipe", () => {
        // The display scale lives here; PAGE_HEADER_TITLE_CLASS reads this
        // entry so a page title is one size everywhere.
        expect(HEADING_SIZE_CLASSES.page).toBe("font-serif text-xl font-medium");
    });

    it("carries no raw gray class and no text below 11px", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src/shared/ui/HeadingUI.tsx"),
            "utf8",
        );
        expect(source).not.toMatch(/gray-(?:50|100|200|300|400|500|600|700|800|900|950)/);
        for (const match of source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
            expect(Number(match[1])).toBeGreaterThanOrEqual(11);
        }
    });
});
