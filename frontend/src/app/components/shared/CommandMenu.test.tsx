// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Render Next's Link as a plain anchor so the dialog needs no router context.
vi.mock("next/link", () => ({
    default: ({ children, ...props }: { children: ReactNode }) =>
        createElement("a", props, children),
}));

import { CommandMenuDialog, KeyboardShortcutsDialog } from "./CommandMenu";

const noRecents = { chats: [], projects: [], reviews: [] };

function renderDialog(
    overrides: Partial<React.ComponentProps<typeof CommandMenuDialog>> = {},
) {
    const onClose = vi.fn();
    const onRunAction = vi.fn();
    render(
        createElement(CommandMenuDialog, {
            open: true,
            onClose,
            inOrganization: false,
            recents: noRecents,
            onRunAction,
            ...overrides,
        }),
    );
    return { onClose, onRunAction };
}

function typeQuery(value: string) {
    fireEvent.change(screen.getByRole("combobox"), { target: { value } });
}

describe("CommandMenuDialog", () => {
    it("is a labelled dialog holding a combobox and a listbox", () => {
        renderDialog();
        const dialog = screen.getByRole("dialog", { name: "Command menu" });
        const combobox = within(dialog).getByRole("combobox");
        expect(combobox).toHaveAttribute("aria-expanded", "true");
        const listboxId = combobox.getAttribute("aria-controls");
        expect(document.getElementById(listboxId!)).toHaveAttribute(
            "role",
            "listbox",
        );
    });

    it("lists a navigation destination as a link and Enter activates it", () => {
        renderDialog();
        const combobox = screen.getByRole("combobox");
        typeQuery("tabular");
        const option = screen.getByRole("option", { name: "Tabular Review" });
        expect(option.tagName).toBe("A");
        expect(option).toHaveAttribute("href", "/tabular-reviews");
        // It is the highlighted option, and Enter activates it.
        expect(combobox.getAttribute("aria-activedescendant")).toBe(option.id);
        const click = vi.spyOn(option, "click").mockImplementation(() => {});
        fireEvent.keyDown(combobox, { key: "Enter" });
        expect(click).toHaveBeenCalledTimes(1);
    });

    it("keeps the current ?side= value on a recent assistant chat", () => {
        const search = window.location.search;
        window.history.replaceState(null, "", "/assistant?side=abc");
        try {
            renderDialog({
                recents: {
                    chats: [
                        { id: "c1", title: "Lease", updated_at: "2026-01-01T00:00:00Z" },
                    ],
                    projects: [],
                    reviews: [],
                },
            });
            typeQuery("Lease");
            expect(screen.getByRole("option", { name: /Lease/ })).toHaveAttribute(
                "href",
                "/assistant/chat/c1?side=abc",
            );
        } finally {
            window.history.replaceState(null, "", `/${search}`);
        }
    });

    it("runs an action item without an href", () => {
        const { onClose, onRunAction } = renderDialog();
        typeQuery("collapse");
        fireEvent.click(screen.getByRole("option", { name: "Toggle sidebar" }));
        expect(onRunAction).toHaveBeenCalledWith("toggle-sidebar");
        expect(onClose).toHaveBeenCalled();
    });

    it("closes on Escape", () => {
        const { onClose } = renderDialog();
        fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
        expect(onClose).toHaveBeenCalled();
    });

    it("shows the No matches state for an unmatched query", () => {
        renderDialog();
        typeQuery("zzqnothingmatches");
        expect(screen.getByText("No matches")).toBeInTheDocument();
        expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
});

describe("KeyboardShortcutsDialog", () => {
    it("is a labelled dialog listing the shortcuts with keys", () => {
        render(
            createElement(KeyboardShortcutsDialog, {
                open: true,
                onClose: vi.fn(),
            }),
        );
        const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
        expect(
            within(dialog).getByText("Open the command menu"),
        ).toBeInTheDocument();
        expect(dialog.querySelector("kbd")).not.toBeNull();
    });
});
