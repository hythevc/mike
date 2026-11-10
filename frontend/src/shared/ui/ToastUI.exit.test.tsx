// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    TOAST_EXIT_CLASS,
    TOAST_EXIT_DURATION_CLASS,
    TOAST_FOCUS_KEY,
    ToastViewportUI,
    clearToasts,
    dismissToast,
    focusToast,
    showToast,
} from "./ToastUI";
import { getSnapshot } from "../lib/toastStore";

/*
 * A toast's exit. The store drops a toast the moment it closes; the viewport
 * keeps drawing it, inert, until its exit transition ends.
 *
 * jsdom loads no stylesheet, so a toast's element has no transition there and
 * leaves the page at once, which is the path ToastUI.test.tsx covers. These
 * tests give the element the computed style the app's CSS gives it in a
 * browser, to reach the path with an exit. e2e/motion.spec.ts cannot cover a
 * toast: the web app raises none on the pages it visits without a backend
 * failure or a destructive action.
 */

type ComputedMotion = Record<
    "transitionProperty" | "transitionDuration" | "transitionDelay" | "opacity",
    string
>;

/** What the browser reports for a toast that has settled on screen. */
const SETTLED: ComputedMotion = {
    transitionProperty: "translate, opacity",
    transitionDuration: "0.18s, 0.18s",
    transitionDelay: "0s, 0s",
    opacity: "1",
};

/**
 * Report `motion` as the computed style of every toast's motion element.
 * Returns the values it reports, so a test can change them as a browser would
 * over the length of a transition.
 */
function computeToastsAs(motion: Partial<ComputedMotion> = {}): ComputedMotion {
    const computed: ComputedMotion = { ...SETTLED, ...motion };
    const reported: Record<string, string> = computed;
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
        const actual = real(element, pseudo);
        if (
            !(element instanceof HTMLElement) ||
            !element.hasAttribute("data-toast-item")
        ) {
            return actual;
        }
        return new Proxy(actual, {
            get(target, property) {
                if (typeof property === "string" && property in reported) {
                    return reported[property];
                }
                const value: unknown = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    });
    return computed;
}

/** What the browser sends when a transition on `element` has finished. */
function endTransition(element: Element, propertyName: string) {
    const event = new Event("transitionend", { bubbles: true });
    Object.defineProperty(event, "propertyName", { value: propertyName });
    act(() => {
        element.dispatchEvent(event);
    });
}

/** The exit's fade finishing: the toast has faded to nothing, and says so. */
function endFade(item: Element, computed: ComputedMotion) {
    computed.opacity = "0";
    endTransition(item, "opacity");
}

const itemOf = (card: HTMLElement) => {
    const item = card.closest<HTMLElement>("[data-toast-item]");
    if (!item) throw new Error("The toast has no motion element.");
    return item;
};

const toastItems = () => document.querySelectorAll("[data-toast-item]");

describe("ToastUI exit", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        clearToasts();
    });
    afterEach(() => {
        clearToasts();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("leaves the page at once where there is no transition to run", () => {
        // jsdom as it is: no stylesheet, so nothing to wait for.
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved" });
        });
        expect(toastItems()).toHaveLength(1);
        act(() => {
            dismissToast(id);
        });
        expect(toastItems()).toHaveLength(0);
    });

    it("keeps a closed toast on the page, out of reach, until its fade ends", () => {
        const computed = computeToastsAs();
        const onClose = vi.fn();
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved", onClose });
        });
        const item = itemOf(screen.getByRole("status"));
        expect(item).not.toHaveAttribute("inert");

        act(() => {
            dismissToast(id);
        });

        // Closed, for everything but the eye: the store has dropped it, its
        // onClose has run, and it can be neither reached nor announced.
        expect(getSnapshot()).toEqual([]);
        expect(onClose).toHaveBeenCalledExactlyOnceWith("dismissed");
        expect(item).toBeInTheDocument();
        expect(item).toHaveAttribute("inert");
        expect(item).toHaveAttribute("aria-hidden", "true");
        expect(screen.queryByRole("status")).toBeNull();
        expect(focusToast(id)).toBe(false);
        // On its way out: the hidden state, on the shorter duration.
        for (const token of [
            ...TOAST_EXIT_CLASS.split(" "),
            TOAST_EXIT_DURATION_CLASS,
        ]) {
            expect(item).toHaveClass(token);
        }

        // The travel finishing is not the end; the fade is, even when both
        // finish in the same frame and the travel reports first.
        computed.opacity = "0";
        endTransition(item, "translate");
        expect(item).toBeInTheDocument();
        endFade(item, computed);
        expect(item).not.toBeInTheDocument();
        expect(toastItems()).toHaveLength(0);
    });

    it("is not ended by a transition inside the card", () => {
        const computed = computeToastsAs();
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({
                message: "Deleted",
                actions: [{ label: "Undo", onClick: () => {} }],
            });
        });
        const item = itemOf(screen.getByRole("status"));
        const undo = screen.getByRole("button", { name: "Undo" });
        act(() => {
            dismissToast(id);
        });

        // A pill in the card eases its own opacity, and the event bubbles.
        // Even with the toast itself already faded, that is not its end.
        computed.opacity = "0";
        endTransition(undo, "opacity");
        expect(item).toBeInTheDocument();
        endFade(item, computed);
        expect(item).not.toBeInTheDocument();
    });

    it("is not ended by its own entrance finishing as it closes", () => {
        const computed = computeToastsAs();
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved" });
        });
        const item = itemOf(screen.getByRole("status"));
        act(() => {
            dismissToast(id);
        });

        // Closed in the frame its entrance ended: the browser still reports
        // that entrance's end, on opacity, with the toast fully drawn. Taking
        // it for the exit's end would cut the fade.
        expect(computed.opacity).toBe("1");
        endTransition(item, "opacity");
        expect(item).toBeInTheDocument();
        expect(item).toHaveAttribute("inert");

        endFade(item, computed);
        expect(item).not.toBeInTheDocument();
    });

    it("removes a leaving toast whose transition never reports back", () => {
        computeToastsAs();
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved" });
        });
        const item = itemOf(screen.getByRole("status"));
        act(() => {
            dismissToast(id);
        });

        // No transitionend (a hidden tab, a cancelled transition): it goes a
        // little after the transition should have ended.
        act(() => {
            vi.advanceTimersByTime(180);
        });
        expect(item).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(150);
        });
        expect(item).not.toBeInTheDocument();
    });

    it("fades a toast whose time ran out, after telling its owner", () => {
        const computed = computeToastsAs();
        const onClose = vi.fn();
        render(<ToastViewportUI />);
        act(() => {
            showToast({ message: "Deleted", durationMs: 2_000, onClose });
        });
        const item = itemOf(screen.getByRole("status"));

        act(() => {
            vi.advanceTimersByTime(2_000);
        });
        // The work the toast held is released when it closes, not when the
        // picture has gone.
        expect(onClose).toHaveBeenCalledExactlyOnceWith("expired");
        expect(item).toBeInTheDocument();
        expect(item).toHaveAttribute("inert");

        endFade(item, computed);
        expect(item).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("hands the keyboard back when the exit starts, not when it ends", () => {
        const computed = computeToastsAs();
        render(
            <>
                <button type="button">Elsewhere</button>
                <ToastViewportUI />
            </>,
        );
        const outside = screen.getByRole("button", { name: "Elsewhere" });
        outside.focus();
        act(() => {
            showToast({
                message: "Deleted",
                durationMs: 8_000,
                actions: [{ label: "Undo", onClick: () => {} }],
            });
        });
        fireEvent.keyDown(window, { key: TOAST_FOCUS_KEY });
        const undo = screen.getByRole("button", { name: "Undo" });
        expect(document.activeElement).toBe(undo);
        const item = itemOf(screen.getByRole("status"));

        act(() => {
            fireEvent.click(undo);
        });

        // The toast is still fading, inert, and inert content cannot hold
        // focus: it has gone back to where it came from already.
        expect(item).toBeInTheDocument();
        expect(item).toHaveAttribute("inert");
        expect(document.activeElement).toBe(outside);

        endFade(item, computed);
        expect(item).not.toBeInTheDocument();
        expect(document.activeElement).toBe(outside);
    });

    it("leaves the focus key to the page while the only toast is leaving", () => {
        computeToastsAs();
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved" });
        });
        act(() => {
            dismissToast(id);
        });
        expect(toastItems()).toHaveLength(1);
        // Not handled: there is no toast left to move to.
        expect(fireEvent.keyDown(window, { key: TOAST_FOCUS_KEY })).toBe(true);
    });

    it("swaps a toast replaced through its dedupe key in place, with no exit", () => {
        computeToastsAs();
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "info", message: "First", dedupeKey: "poll" });
        });
        act(() => {
            showToast({ tone: "info", message: "Second", dedupeKey: "poll" });
        });
        // Two cards stacked for the length of a fade would read as two
        // notices; the newcomer's entrance is the whole swap.
        expect(toastItems()).toHaveLength(1);
        expect(screen.getByRole("status")).toHaveTextContent("Second");
    });

    it("fades every toast out when the stack is cleared", () => {
        const computed = computeToastsAs();
        render(<ToastViewportUI />);
        act(() => {
            showToast({ message: "One" });
            showToast({ message: "Two" });
        });
        const items = [...toastItems()];
        expect(items).toHaveLength(2);

        act(() => {
            clearToasts();
        });
        expect(screen.queryAllByRole("status")).toHaveLength(0);
        for (const item of items) expect(item).toHaveAttribute("inert");

        endFade(items[0], computed);
        expect(toastItems()).toHaveLength(1);
        endFade(items[1], computed);
        expect(toastItems()).toHaveLength(0);
    });

    it("keeps a leaving toast in its place while a new one arrives below it", () => {
        computeToastsAs();
        render(<ToastViewportUI />);
        let first = "";
        act(() => {
            first = showToast({ message: "First" });
            showToast({ message: "Second" });
        });
        act(() => {
            dismissToast(first);
        });
        act(() => {
            showToast({ message: "Third" });
        });
        expect([...toastItems()].map((item) => item.textContent)).toEqual([
            "First",
            "Second",
            "Third",
        ]);
        expect(
            screen.getAllByRole("status").map((card) => card.textContent),
        ).toEqual(["Second", "Third"]);
    });

    it.each([
        ["has transition: none", { transitionProperty: "none" }],
        ["has a zero duration", { transitionDuration: "0s, 0s" }],
        ["is still hidden before its entrance", { opacity: "0" }],
    ] as const)("removes at once a toast that %s", (_reason, motion) => {
        computeToastsAs(motion);
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved" });
        });
        act(() => {
            dismissToast(id);
        });
        expect(toastItems()).toHaveLength(0);
    });

    it("drops what is still leaving when the viewport itself goes", () => {
        computeToastsAs();
        const { unmount } = render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Saved" });
        });
        act(() => {
            dismissToast(id);
        });
        expect(toastItems()).toHaveLength(1);
        unmount();

        // A fresh viewport does not bring the old picture back, and the
        // fallback timer of the old one has nothing left to do.
        render(<ToastViewportUI />);
        expect(toastItems()).toHaveLength(0);
        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        expect(toastItems()).toHaveLength(0);
    });
});
