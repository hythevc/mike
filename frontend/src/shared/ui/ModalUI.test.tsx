import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModalUI } from "./ModalUI";
import { Modal } from "@/app/components/modals/Modal";

describe("ModalUI", () => {
    it("renders shared modal chrome, content, and action slots", async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <ModalUI
                open
                onClose={onClose}
                breadcrumbs={["Documents", "Add documents"]}
                ariaLabel="Add documents"
                primaryAction={<button type="button">Confirm</button>}
            >
                <p>Select documents</p>
            </ModalUI>,
        );

        expect(
            screen.getByRole("dialog", { name: "Add documents" }),
        ).toHaveClass("liquid-glass-modal");
        expect(screen.getByText("Select documents")).toBeVisible();
        expect(screen.getByRole("button", { name: "Confirm" })).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("closes on Escape", () => {
        const onClose = vi.fn();

        render(
            <ModalUI open onClose={onClose} ariaLabel="Example">
                Content
            </ModalUI>,
        );

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("leaves Escape to a control inside the dialog that handled it", () => {
        const onClose = vi.fn();

        render(
            <ModalUI open onClose={onClose} ariaLabel="Example">
                <input
                    aria-label="Search"
                    onKeyDown={(event) => {
                        if (event.key === "Escape") event.preventDefault();
                    }}
                />
            </ModalUI>,
        );

        fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), {
            key: "Escape",
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("names the dialog from a title rendered as a heading", () => {
        render(
            <ModalUI open onClose={vi.fn()} title="New project">
                Content
            </ModalUI>,
        );
        const heading = screen.getByRole("heading", { name: "New project" });
        const dialog = screen.getByRole("dialog", { name: "New project" });
        expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
        expect(heading.id).toBeTruthy();
    });

    it("wires a description to aria-describedby", () => {
        render(
            <ModalUI
                open
                onClose={vi.fn()}
                title="New project"
                description="Give it a name your team will recognise."
            >
                Content
            </ModalUI>,
        );
        const dialog = screen.getByRole("dialog", { name: "New project" });
        const describedBy = dialog.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)).toHaveTextContent(
            "Give it a name your team will recognise.",
        );
    });

    it("names a Modal-wrapper dialog from its last breadcrumb", () => {
        render(
            <Modal
                open
                onClose={vi.fn()}
                breadcrumbs={["Documents", "Add documents"]}
            >
                Content
            </Modal>,
        );
        expect(
            screen.getByRole("dialog", { name: "Add documents" }),
        ).toBeInTheDocument();
    });

    it("grows to a natural height and scrolls its body, with no fixed height", () => {
        render(
            <ModalUI open onClose={vi.fn()} title="Tall">
                <div style={{ height: 4000 }}>Tall content</div>
            </ModalUI>,
        );
        const dialog = screen.getByRole("dialog", { name: "Tall" });
        // Capped at the viewport, never a fixed height. `max-h-*` is allowed;
        // a bare `h-*` token (h-80, h-full, h-[..]) is not.
        expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
        const heightTokens = dialog.className
            .split(/\s+/)
            .filter((token) => /^h-/.test(token));
        expect(heightTokens).toEqual([]);
        // The body is the scroll region.
        const body = dialog.querySelector("[data-modal-scroll]");
        expect(body?.className).toContain("overflow-y-auto");
    });

    it("declares enter and exit motion on W26's tokens with a reduced-motion variant", () => {
        render(
            <ModalUI open onClose={vi.fn()} title="Motion">
                Content
            </ModalUI>,
        );
        const dialog = screen.getByRole("dialog", { name: "Motion" });
        expect(dialog).toHaveAttribute("data-state", "open");
        const cls = dialog.className;
        expect(cls).toContain("data-[state=open]:animate-in");
        expect(cls).toContain("data-[state=closed]:animate-out");
        expect(cls).toContain(
            "data-[state=open]:animation-duration-(--motion-duration-enter)",
        );
        expect(cls).toContain(
            "data-[state=closed]:animation-duration-(--motion-duration-exit)",
        );
        expect(cls).toContain("ease-out-strong");
        expect(cls).toContain("motion-reduce:");
        // Only transform and opacity animate; no layout property, no ease-in.
        expect(cls).not.toContain("transition-all");
        expect(cls).not.toMatch(/\bease-in\b/);
    });
});
