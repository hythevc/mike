// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, useState, type ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCommandMenuShortcut } from "./useCommandMenuShortcut";

function Harness(): ReactElement {
    const [open, setOpen] = useState(false);
    useCommandMenuShortcut({ open, setOpen });
    return createElement(
        "div",
        null,
        createElement("button", { type: "button", "data-testid": "opener" }, "Open"),
        createElement("span", { "data-testid": "state" }, open ? "open" : "closed"),
        createElement(
            "div",
            { className: "docx-editor" },
            createElement("input", { "data-testid": "docx" }),
        ),
        createElement(
            "div",
            { className: "markdown-editor-content" },
            createElement("input", { "data-testid": "md" }),
        ),
        createElement(
            "div",
            { className: "fortune-container" },
            createElement("input", { "data-testid": "sheet" }),
        ),
    );
}

function state() {
    return screen.getByTestId("state").textContent;
}

describe("useCommandMenuShortcut", () => {
    it("toggles on Cmd/Ctrl+K", () => {
        render(createElement(Harness));
        expect(state()).toBe("closed");
        fireEvent.keyDown(document, { key: "k", metaKey: true });
        expect(state()).toBe("open");
        fireEvent.keyDown(document, { key: "k", ctrlKey: true });
        expect(state()).toBe("closed");
    });

    it("ignores an event already handled", () => {
        render(createElement(Harness));
        document.addEventListener(
            "keydown",
            (event) => event.preventDefault(),
            { capture: true, once: true },
        );
        fireEvent.keyDown(document, { key: "k", metaKey: true });
        expect(state()).toBe("closed");
    });

    it.each(["docx", "md", "sheet"])(
        "ignores Cmd/Ctrl+K raised inside the %s editor",
        (testId) => {
            render(createElement(Harness));
            fireEvent.keyDown(screen.getByTestId(testId), {
                key: "k",
                metaKey: true,
            });
            expect(state()).toBe("closed");
        },
    );

    it("returns focus to the element that opened the menu", () => {
        render(createElement(Harness));
        const opener = screen.getByTestId("opener");
        act(() => opener.focus());
        expect(document.activeElement).toBe(opener);

        fireEvent.keyDown(document, { key: "k", metaKey: true });
        expect(state()).toBe("open");
        // Something else takes focus while the menu is open.
        act(() => (document.getElementById("elsewhere") ?? document.body).focus());

        fireEvent.keyDown(document, { key: "k", metaKey: true });
        expect(state()).toBe("closed");
        expect(document.activeElement).toBe(opener);
    });
});
