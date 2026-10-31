import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_VISIBLE_TOASTS,
    TOAST_FOCUS_KEY,
    focusToast,
    ToastViewportUI,
    clearToasts,
    dismissToast,
    showToast,
} from "./ToastUI";
import { getSnapshot } from "../lib/toastStore";

describe("ToastUI", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        clearToasts();
    });
    afterEach(() => {
        clearToasts();
        vi.useRealTimers();
    });

    it("renders an error toast as an alert with title, message and dismiss", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                title: "Couldn't save the document",
                message: "Mike couldn't reach the server.",
            });
        });
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("Couldn't save the document");
        expect(alert).toHaveTextContent("Mike couldn't reach the server.");
        expect(alert).toHaveClass("liquid-glass-float");

        fireEvent.click(
            screen.getByRole("button", { name: "Dismiss notification" }),
        );
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("runs a Retry action and closes the toast", async () => {
        const onRetry = vi.fn();
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                actions: [{ label: "Retry", onClick: onRetry }],
            });
        });
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledOnce();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("links Contact support to the given href", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:will@mikeoss.com?subject=x",
            });
        });
        const link = screen.getByRole("link", { name: "Contact support" });
        expect(link).toHaveAttribute("href", "mailto:will@mikeoss.com?subject=x");
    });

    it("keeps an error with actions until dismissed but auto-dismisses success", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Sticky",
                actions: [{ label: "Retry", onClick: () => {} }],
            });
            showToast({ tone: "success", message: "Saved" });
        });
        expect(screen.getByRole("status")).toHaveTextContent("Saved");
        act(() => {
            vi.advanceTimersByTime(4_100);
        });
        expect(screen.queryByRole("status")).toBeNull();
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(screen.getByRole("alert")).toHaveTextContent("Sticky");
    });

    it("auto-dismisses a plain error toast after its duration", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "error", message: "Plain" });
        });
        expect(screen.getByRole("alert")).toBeVisible();
        act(() => {
            vi.advanceTimersByTime(10_100);
        });
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("pauses the timer while hovered", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "info", message: "Hover me" });
        });
        const toast = screen.getByRole("status");
        fireEvent.mouseEnter(toast);
        act(() => {
            vi.advanceTimersByTime(20_000);
        });
        expect(screen.getByRole("status")).toBeVisible();
        fireEvent.mouseLeave(toast);
        act(() => {
            vi.advanceTimersByTime(6_000);
        });
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("keeps a timed toast while keyboard focus remains after the pointer leaves", () => {
        render(<ToastViewportUI />);
        act(() => { showToast({ message: "Read this", durationMs: 2000 }); });
        const toast = screen.getByRole("status");
        const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
        fireEvent.mouseEnter(toast);
        fireEvent.focus(dismiss);
        fireEvent.mouseLeave(toast);
        act(() => { vi.advanceTimersByTime(10000); });
        expect(toast).toBeVisible();
        fireEvent.blur(dismiss, { relatedTarget: document.body });
        act(() => { vi.advanceTimersByTime(2100); });
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("replaces toasts that share a dedupe key", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "error", message: "First", dedupeKey: "poll" });
            showToast({ tone: "error", message: "Second", dedupeKey: "poll" });
        });
        const alerts = screen.getAllByRole("alert");
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toHaveTextContent("Second");
    });

    it("drops the oldest toast beyond the visible maximum", () => {
        render(<ToastViewportUI />);
        act(() => {
            for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i += 1) {
                showToast({ tone: "info", message: `Toast ${i}` });
            }
        });
        const items = screen.getAllByTestId("toast");
        expect(items).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(items[0]).toHaveTextContent("Toast 2");
    });

    it("evicts chatter before an error the user still has to act on", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Upload failed",
                actions: [{ label: "Retry", onClick: () => {} }],
            });
            for (let i = 0; i < MAX_VISIBLE_TOASTS; i += 1) {
                showToast({ tone: "success", message: `Saved ${i}` });
            }
        });
        const items = screen.getAllByTestId("toast");
        expect(items).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(items[0]).toHaveTextContent("Upload failed");
        expect(
            screen.getByRole("button", { name: "Retry" }),
        ).toBeInTheDocument();
        // The oldest success was dropped in its place.
        expect(screen.queryByText("Saved 0")).toBeNull();
    });

    it("falls back to the oldest when every toast is actionable", () => {
        render(<ToastViewportUI />);
        act(() => {
            for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i += 1) {
                showToast({
                    tone: "error",
                    message: `Error ${i}`,
                    actions: [{ label: "Retry", onClick: () => {} }],
                });
            }
        });
        const items = screen.getAllByTestId("toast");
        expect(items).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(items[0]).toHaveTextContent("Error 1");
    });

    it("dismissToast ignores unknown ids", () => {
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "x" });
            dismissToast("nope");
        });
        expect(screen.getByRole("status")).toBeVisible();
        act(() => {
            dismissToast(id);
        });
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("labels the viewport as a region and leaves the live role to each toast", () => {
        render(<ToastViewportUI />);
        const region = screen.getByRole("region", { name: "Notifications" });
        // A live region wrapping live items is announced twice, or not at all.
        expect(region).not.toHaveAttribute("aria-live");
        act(() => {
            showToast({ tone: "error", message: "Failed" });
            showToast({ tone: "info", message: "FYI" });
        });
        expect(screen.getByRole("alert")).toHaveTextContent("Failed");
        expect(screen.getByRole("status")).toHaveTextContent("FYI");
    });

    it("does not steal focus, but focusToast can move it to a toast", () => {
        render(
            <>
                <button type="button">Elsewhere</button>
                <ToastViewportUI />
            </>,
        );
        const outside = screen.getByRole("button", { name: "Elsewhere" });
        outside.focus();
        let id = "";
        act(() => {
            id = showToast({
                tone: "error",
                message: "Failed",
                actions: [{ label: "Retry", onClick: () => {} }],
            });
        });
        expect(document.activeElement).toBe(outside);

        let moved = false;
        act(() => {
            moved = focusToast(id);
        });
        expect(moved).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole("alert"));
        expect(screen.getByRole("alert")).toHaveAttribute("tabindex", "-1");

        act(() => {
            dismissToast(id);
        });
        expect(focusToast(id)).toBe(false);
    });

    it("never gives two actions on one toast the same look", () => {
        render(<ToastViewportUI />);
        const looks = (labels: string[]) =>
            labels.map((name) => {
                const node =
                    screen.queryByRole("link", { name }) ??
                    screen.getByRole("button", { name });
                if (node.className.includes("bg-gray-950/88")) return "black";
                if (node.className.includes("liquid-glass-flat")) return "white";
                return "text";
            });

        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:support@example.com",
                dedupeKey: "looks",
            });
        });
        expect(looks(["Contact support"])).toEqual(["black"]);

        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:support@example.com",
                actions: [{ label: "Retry", onClick: () => {} }],
                dedupeKey: "looks",
            });
        });
        expect(looks(["Contact support", "Retry"])).toEqual(["white", "black"]);

        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:support@example.com",
                actions: [
                    { label: "Retry", onClick: () => {} },
                    { label: "Sign in", onClick: () => {} },
                ],
                dedupeKey: "looks",
            });
        });
        expect(looks(["Contact support", "Retry", "Sign in"])).toEqual([
            "text",
            "white",
            "black",
        ]);
    });

    describe("onClose", () => {
        it("says the toast expired once its own timer ran out, hover pauses included", () => {
            const onClose = vi.fn();
            render(<ToastViewportUI />);
            act(() => {
                showToast({ message: "Deleted", durationMs: 8_000, onClose });
            });
            fireEvent.mouseEnter(screen.getByRole("status"));
            act(() => {
                vi.advanceTimersByTime(30_000);
            });
            expect(onClose).not.toHaveBeenCalled();

            fireEvent.mouseLeave(screen.getByRole("status"));
            act(() => {
                vi.advanceTimersByTime(8_100);
            });
            expect(onClose).toHaveBeenCalledExactlyOnceWith("expired");
            expect(screen.queryByRole("status")).toBeNull();
        });

        it("tells a closed toast from one whose action was chosen", () => {
            const closed = vi.fn();
            const acted = vi.fn();
            const undo = vi.fn();
            render(<ToastViewportUI />);
            act(() => {
                showToast({ message: "Closed", dedupeKey: "a", onClose: closed });
            });
            fireEvent.click(
                screen.getByRole("button", { name: "Dismiss notification" }),
            );
            act(() => {
                showToast({
                    message: "Acted on",
                    dedupeKey: "b",
                    actions: [{ label: "Undo", onClick: undo }],
                    onClose: acted,
                });
            });
            fireEvent.click(screen.getByRole("button", { name: "Undo" }));

            expect(closed).toHaveBeenCalledExactlyOnceWith("dismissed");
            expect(acted).toHaveBeenCalledExactlyOnceWith("action");
            expect(undo).toHaveBeenCalledOnce();
        });

        it("names a toast that was replaced or cleared", () => {
            const replaced = vi.fn();
            const cleared = vi.fn();
            act(() => {
                showToast({ message: "Old", dedupeKey: "same", onClose: replaced });
                showToast({ message: "New", dedupeKey: "same" });
                showToast({ message: "Last", onClose: cleared });
                clearToasts();
            });

            expect(replaced).toHaveBeenCalledExactlyOnceWith("replaced");
            expect(cleared).toHaveBeenCalledExactlyOnceWith("cleared");
        });

        // Its onClose is where its work finishes, such as a delete that
        // waits for Undo: pushing it out would cut that window short.
        it("keeps a toast that holds work in a full stack until its own timer ends", () => {
            const onClose = vi.fn();
            render(<ToastViewportUI />);
            act(() => {
                showToast({ message: "Deleted", durationMs: 8_000, onClose });
                for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i += 1) {
                    showToast({ message: `Newer ${i}`, durationMs: 60_000 });
                }
            });
            expect(screen.getByText("Deleted")).toBeInTheDocument();
            expect(screen.getAllByTestId("toast")).toHaveLength(
                MAX_VISIBLE_TOASTS,
            );
            expect(onClose).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(8_000);
            });
            expect(onClose).toHaveBeenCalledExactlyOnceWith("expired");
            expect(screen.queryByText("Deleted")).toBeNull();
        });

        it("lets toasts that hold work stack past the visible maximum", () => {
            render(<ToastViewportUI />);
            act(() => {
                for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i += 1) {
                    showToast({
                        message: `Deleted ${i}`,
                        durationMs: 8_000,
                        onClose: () => {},
                    });
                }
            });
            expect(screen.getAllByTestId("toast")).toHaveLength(
                MAX_VISIBLE_TOASTS + 2,
            );
        });

        it("runs once, after the toast has left the stack", () => {
            // Whether the toast was still in the stack each time it ran.
            const stillListed: boolean[] = [];
            let id = "";
            act(() => {
                id = showToast({
                    message: "Once",
                    onClose: () => {
                        stillListed.push(
                            getSnapshot().some((toast) => toast.id === id),
                        );
                    },
                });
            });
            act(() => {
                dismissToast(id);
                dismissToast(id);
                clearToasts();
            });
            expect(stillListed).toEqual([false]);
        });
    });

    it("drops plain notices before one with an action", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                message: "Export ready",
                actions: [{ label: "Open", onClick: () => {} }],
            });
            for (let i = 0; i < MAX_VISIBLE_TOASTS; i += 1) {
                showToast({ tone: "success", message: `Saved ${i}` });
            }
        });
        expect(screen.getAllByTestId("toast")).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(screen.getByText("Export ready")).toBeInTheDocument();
        expect(screen.queryByText("Saved 0")).toBeNull();
    });

    describe("focus key", () => {
        const undoToast = (onUndo = () => {}) =>
            showToast({
                title: "Chat deleted",
                message: "“Lease review” was deleted.",
                durationMs: 8_000,
                actions: [{ label: "Undo", onClick: onUndo }],
            });

        function renderWithOutsideButton() {
            render(
                <>
                    <button type="button">Elsewhere</button>
                    <ToastViewportUI />
                </>,
            );
            const outside = screen.getByRole("button", { name: "Elsewhere" });
            outside.focus();
            return outside;
        }

        /** Let the focus hand-back, which waits for the card to go, run. */
        async function settle() {
            await act(async () => {
                await Promise.resolve();
            });
        }

        it("moves the keyboard onto the newest toast's action, which holds its timer", () => {
            const plainClosed = vi.fn();
            renderWithOutsideButton();
            act(() => {
                showToast({ message: "Saved" });
                undoToast();
                showToast({ message: "Synced", onClose: plainClosed });
            });

            // The newest toast with an action wins over a newer plain one.
            const unhandled = fireEvent.keyDown(window, {
                key: TOAST_FOCUS_KEY,
            });
            expect(unhandled).toBe(false);
            const undo = screen.getByRole("button", { name: "Undo" });
            expect(document.activeElement).toBe(undo);

            act(() => {
                vi.advanceTimersByTime(60_000);
            });
            expect(screen.getByRole("button", { name: "Undo" })).toBe(undo);
            // The other toasts' timers kept running.
            expect(plainClosed).toHaveBeenCalledExactlyOnceWith("expired");
        });

        it("falls back to the newest toast when none has an action", () => {
            renderWithOutsideButton();
            act(() => {
                showToast({ message: "Saved" });
                showToast({ message: "Synced" });
            });

            fireEvent.keyDown(window, { key: TOAST_FOCUS_KEY });

            expect(document.activeElement).toHaveTextContent("Synced");
        });

        it("hands focus back to where it was once the toast closes", async () => {
            const onUndo = vi.fn();
            const outside = renderWithOutsideButton();
            act(() => {
                undoToast(onUndo);
            });
            fireEvent.keyDown(window, { key: TOAST_FOCUS_KEY });
            const undo = screen.getByRole("button", { name: "Undo" });
            expect(document.activeElement).toBe(undo);

            act(() => {
                fireEvent.click(undo);
            });
            await settle();

            expect(onUndo).toHaveBeenCalledOnce();
            expect(screen.queryByRole("status")).toBeNull();
            expect(document.activeElement).toBe(outside);
        });

        it("returns focus that arrived by Tab as well", async () => {
            const outside = renderWithOutsideButton();
            act(() => {
                undoToast();
            });
            const undo = screen.getByRole("button", { name: "Undo" });
            fireEvent.focus(undo, { relatedTarget: outside });
            undo.focus();

            act(() => {
                vi.advanceTimersByTime(60_000);
            });
            expect(screen.getByRole("status")).toBeInTheDocument();

            act(() => {
                dismissToast(getSnapshot()[0].id);
            });
            await settle();
            expect(document.activeElement).toBe(outside);
        });

        it("does not pull focus back once the person has moved on", async () => {
            renderWithOutsideButton();
            act(() => {
                undoToast();
            });
            fireEvent.keyDown(window, { key: TOAST_FOCUS_KEY });
            fireEvent.blur(screen.getByRole("button", { name: "Undo" }), {
                relatedTarget: document.body,
            });

            act(() => {
                dismissToast(getSnapshot()[0].id);
            });
            await settle();

            expect(document.activeElement).toBe(document.body);
        });

        it("leaves the key to the page when no toast is on screen or it is modified", () => {
            const outside = renderWithOutsideButton();
            expect(
                fireEvent.keyDown(window, { key: TOAST_FOCUS_KEY }),
            ).toBe(true);

            act(() => {
                undoToast();
            });
            expect(
                fireEvent.keyDown(window, {
                    key: TOAST_FOCUS_KEY,
                    shiftKey: true,
                }),
            ).toBe(true);
            expect(document.activeElement).toBe(outside);
        });

        it("tells screen readers how to reach a timed action, and only that", () => {
            render(<ToastViewportUI />);
            act(() => {
                undoToast();
                showToast({
                    tone: "error",
                    message: "Upload failed",
                    actions: [{ label: "Retry", onClick: () => {} }],
                });
                showToast({ message: "Saved" });
            });

            const [undoNotice, plainNotice] = screen.getAllByRole("status");
            expect(undoNotice).toHaveTextContent(
                `Press ${TOAST_FOCUS_KEY} to reach Undo.`,
            );
            expect(plainNotice).not.toHaveTextContent(TOAST_FOCUS_KEY);
            // A failure that waits for the person needs no head start.
            expect(screen.getByRole("alert")).not.toHaveTextContent(
                TOAST_FOCUS_KEY,
            );
        });
    });
});
