// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openCommandMenu } = vi.hoisted(() => ({ openCommandMenu: vi.fn() }));

vi.mock("@/app/components/shared/CommandMenu", () => ({
    useCommandMenu: () => ({
        openCommandMenu,
        openKeyboardShortcuts: vi.fn(),
    }),
}));

import { CommandMenuTrigger } from "./CommandMenuTrigger";

beforeEach(() => openCommandMenu.mockClear());

describe("CommandMenuTrigger", () => {
    it("shows the shortcut and opens the menu when the sidebar is expanded", () => {
        render(createElement(CommandMenuTrigger, { isOpen: true }));
        const button = screen.getByRole("button", { name: /search/i });
        expect(button.querySelector("kbd")).not.toBeNull();
        fireEvent.click(button);
        expect(openCommandMenu).toHaveBeenCalledTimes(1);
    });

    it("falls back to a labelled icon button when collapsed", () => {
        render(createElement(CommandMenuTrigger, { isOpen: false }));
        const button = screen.getByRole("button", { name: "Command menu" });
        fireEvent.click(button);
        expect(openCommandMenu).toHaveBeenCalledTimes(1);
    });
});
