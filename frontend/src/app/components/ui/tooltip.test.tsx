// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipProvider } from "./tooltip";

afterEach(() => {
    vi.useRealTimers();
});

describe("Tooltip", () => {
    it("opens on keyboard focus with no delay and references the trigger", async () => {
        render(
            <Tooltip content="Opens the command menu">
                <button type="button" aria-label="Commands">
                    ⌘
                </button>
            </Tooltip>,
        );
        const trigger = screen.getByRole("button", { name: "Commands" });
        act(() => trigger.focus());

        const tooltip = await screen.findByRole("tooltip");
        expect(tooltip).toHaveTextContent("Opens the command menu");
        expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    });

    it("opens on hover only after the delay", async () => {
        vi.useFakeTimers();
        try {
            render(
                <Tooltip content="Row actions" delayMs={400}>
                    <button type="button" aria-label="Row actions">
                        ⋯
                    </button>
                </Tooltip>,
            );
            const trigger = screen.getByRole("button", { name: "Row actions" });
            fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
            expect(screen.queryByRole("tooltip")).toBeNull();
            act(() => {
                vi.advanceTimersByTime(400);
            });
            expect(screen.getByRole("tooltip")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("closes on Escape", async () => {
        render(
            <Tooltip content="Close chat panel">
                <button type="button" aria-label="Close chat panel">
                    ×
                </button>
            </Tooltip>,
        );
        const trigger = screen.getByRole("button", { name: "Close chat panel" });
        act(() => trigger.focus());
        await screen.findByRole("tooltip");

        fireEvent.keyDown(trigger, { key: "Escape" });
        await waitFor(() =>
            expect(screen.queryByRole("tooltip")).toBeNull(),
        );
    });

    it("keeps the trigger's visible-text accessible name unchanged", async () => {
        render(
            <Tooltip content="Saves this decision to the matter record">
                <button type="button">Save decision</button>
            </Tooltip>,
        );
        const trigger = screen.getByRole("button", { name: "Save decision" });
        expect(trigger).not.toHaveAttribute("aria-label");
        act(() => trigger.focus());
        await screen.findByRole("tooltip");
        // The name is still the visible text; the tooltip only describes it.
        expect(
            screen.getByRole("button", { name: "Save decision" }),
        ).toBe(trigger);
    });

    it("wraps a disabled control in a focusable element so its tooltip still shows", async () => {
        render(
            <Tooltip content="You cannot delete a shared review">
                <button type="button" disabled aria-label="Delete review">
                    🗑
                </button>
            </Tooltip>,
        );
        const trigger = screen.getByRole("button", { name: "Delete review" });
        expect(trigger).toBeDisabled();
        const wrapper = trigger.parentElement as HTMLElement;
        expect(wrapper.tabIndex).toBe(0);

        act(() => wrapper.focus());
        const tooltip = await screen.findByRole("tooltip");
        expect(tooltip).toHaveTextContent("You cannot delete a shared review");
        expect(wrapper.getAttribute("aria-describedby")).toBe(tooltip.id);
    });

    it("does not open for a touch-only pointer", () => {
        render(
            <TooltipProvider>
                <Tooltip content="Row actions">
                    <button type="button" aria-label="Row actions">
                        ⋯
                    </button>
                </Tooltip>
            </TooltipProvider>,
        );
        const trigger = screen.getByRole("button", { name: "Row actions" });
        // A tap registers as a touch pointer and then focuses the control;
        // neither should open a tooltip the person cannot dismiss.
        fireEvent.pointerEnter(trigger, { pointerType: "touch" });
        fireEvent.pointerDown(trigger, { pointerType: "touch" });
        act(() => trigger.focus());
        expect(screen.queryByRole("tooltip")).toBeNull();
    });
});
