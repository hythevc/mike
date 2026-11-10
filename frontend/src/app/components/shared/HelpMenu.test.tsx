// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
    default: ({ children, ...props }: { children: ReactNode }) =>
        createElement("a", props, children),
}));

const { openKeyboardShortcuts } = vi.hoisted(() => ({
    openKeyboardShortcuts: vi.fn(),
}));

vi.mock("@/app/components/shared/CommandMenu", () => ({
    useCommandMenu: () => ({
        openCommandMenu: vi.fn(),
        openKeyboardShortcuts,
    }),
}));

import { HelpMenu, HelpMenuItems } from "./HelpMenu";
import {
    Dropdown,
    DropdownContent,
    DropdownTrigger,
} from "@/shared/ui/dropdown";
import { brand } from "@/shared/brand.generated";

beforeEach(() => openKeyboardShortcuts.mockClear());

function OpenMenu() {
    return (
        <Dropdown defaultOpen modal={false}>
            <DropdownTrigger>open</DropdownTrigger>
            <DropdownContent>
                <HelpMenuItems />
            </DropdownContent>
        </Dropdown>
    );
}

describe("HelpMenu", () => {
    it("lists documentation, shortcuts, support, about, source and legal links", async () => {
        render(<OpenMenu />);
        const docs = await screen.findByRole("menuitem", {
            name: "Documentation",
        });
        expect(docs).toHaveAttribute("href", brand.docsUrl);
        expect(docs).toHaveAttribute("target", "_blank");
        expect(docs.getAttribute("rel")).toContain("noreferrer");

        expect(
            screen.getByRole("menuitem", { name: "Support" }),
        ).toHaveAttribute("href", "/support");
        expect(
            screen.getByRole("menuitem", { name: "About" }),
        ).toHaveAttribute("href", "/settings/about");
        expect(
            screen.getByRole("menuitem", { name: "Source code" }),
        ).toHaveAttribute("href", "/source");
        expect(
            screen.getByRole("menuitem", { name: "Terms" }),
        ).toHaveAttribute("href", brand.legalDocuments.terms.url);
        expect(
            screen.getByRole("menuitem", { name: "Privacy" }),
        ).toHaveAttribute("href", brand.legalDocuments.privacy.url);
    });

    it("opens the keyboard-shortcuts dialog from its item", async () => {
        render(<OpenMenu />);
        const item = await screen.findByRole("menuitem", {
            name: "Keyboard shortcuts",
        });
        expect(item).not.toHaveAttribute("href");
        fireEvent.click(item);
        expect(openKeyboardShortcuts).toHaveBeenCalledTimes(1);
    });

    it("renders a labelled trigger for the standalone menu", () => {
        render(<HelpMenu />);
        expect(
            screen.getByRole("button", { name: "Help" }),
        ).toBeInTheDocument();
    });
});
