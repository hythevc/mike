// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TEXT_VARIANT_CLASSES, TextUI, type TextUIVariant } from "./TextUI";

describe("TextUI", () => {
    it("renders a paragraph by default", () => {
        const { container } = render(<TextUI>Body copy</TextUI>);
        expect(container.querySelector("p")).toHaveTextContent("Body copy");
    });

    it("renders an inline element when asked", () => {
        const { container } = render(
            <TextUI as="span" variant="badge">
                12
            </TextUI>,
        );
        expect(container.querySelector("span")).toHaveTextContent("12");
    });

    it("applies each variant's documented size and colour", () => {
        const variants: TextUIVariant[] = [
            "body",
            "chrome",
            "subtle",
            "muted",
            "badge",
        ];
        for (const variant of variants) {
            const { unmount } = render(
                <TextUI variant={variant} as="span">
                    {variant}
                </TextUI>,
            );
            const node = screen.getByText(variant);
            for (const token of TEXT_VARIANT_CLASSES[variant].split(" ")) {
                expect(node).toHaveClass(token);
            }
            unmount();
        }
    });

    it("adds a medium weight for a label line", () => {
        render(
            <TextUI variant="subtle" weight="medium">
                Theme
            </TextUI>,
        );
        expect(screen.getByText("Theme")).toHaveClass("font-medium");
    });

    it("switches colour for a status tone", () => {
        render(
            <TextUI tone="danger">Couldn’t save the document.</TextUI>,
        );
        expect(
            screen.getByText("Couldn’t save the document."),
        ).toHaveClass("text-danger");
    });

    it("keeps the badge variant at the 11px floor, not below", () => {
        expect(TEXT_VARIANT_CLASSES.badge).toContain("text-[11px]");
    });

    it("carries no raw gray class and no text below 11px", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src/shared/ui/TextUI.tsx"),
            "utf8",
        );
        expect(source).not.toMatch(/gray-(?:50|100|200|300|400|500|600|700|800|900|950)/);
        for (const match of source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
            expect(Number(match[1])).toBeGreaterThanOrEqual(11);
        }
    });
});
