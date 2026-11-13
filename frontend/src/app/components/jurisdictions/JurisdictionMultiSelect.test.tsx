// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JurisdictionEntry } from "@/app/lib/mikeApi";
import { JurisdictionMultiSelect } from "./JurisdictionMultiSelect";

const OPTIONS: JurisdictionEntry[] = [
    { code: "US", name: "United States", kind: "country", parent: null, languages: ["en"] },
    { code: "US_CA", name: "California", kind: "subdivision", parent: "US", languages: ["en"] },
    { code: "GB", name: "United Kingdom", kind: "country", parent: null, languages: ["en"] },
    { code: "EU", name: "European Union", kind: "supranational", parent: null, languages: ["en", "fr", "de"] },
    { code: "PT", name: "Portugal", kind: "country", parent: null, languages: ["pt"] },
];
const EMPTY = "No jurisdictions chosen.";

/** The control with its visible label and its own state, as a form holds it. */
function Field({
    initial = [],
    max = 10,
    disabled = false,
    readOnly = false,
    onChange = () => {},
}: {
    initial?: string[];
    max?: number;
    disabled?: boolean;
    readOnly?: boolean;
    onChange?: (codes: string[]) => void;
}) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <label htmlFor="jurisdictions">Jurisdictions</label>
            <JurisdictionMultiSelect
                id="jurisdictions"
                value={value}
                onChange={(codes) => {
                    setValue(codes);
                    onChange(codes);
                }}
                options={OPTIONS}
                max={max}
                emptyText={EMPTY}
                disabled={disabled}
                readOnly={readOnly}
            />
            <button type="button">After</button>
        </>
    );
}

const trigger = () => screen.getByRole("button", { name: "Jurisdictions" });
const option = (name: RegExp) => screen.getByRole("menuitemcheckbox", { name });
const chosen = () => screen.queryByRole("list", { name: "Chosen jurisdictions" });

describe("JurisdictionMultiSelect", () => {
    describe("the empty state", () => {
        it("says nothing is chosen, lists nothing, and offers nothing to clear", () => {
            render(<Field />);
            expect(trigger()).toHaveTextContent("Select jurisdictions");
            expect(screen.getByText(EMPTY)).toBeInTheDocument();
            expect(chosen()).toBeNull();
            expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
        });

        it("ties the empty-state sentence to the control, for a screen reader", () => {
            render(<Field />);
            expect(trigger()).toHaveAccessibleDescription(EMPTY);
        });
    });

    describe("choosing", () => {
        it("takes its name from the visible label", () => {
            render(<Field />);
            expect(screen.getByLabelText("Jurisdictions")).toBe(trigger());
        });

        it("offers every jurisdiction as a checkbox that says whether it is chosen", async () => {
            const user = userEvent.setup();
            render(<Field initial={["GB"]} />);
            await user.click(trigger());

            const items = screen.getAllByRole("menuitemcheckbox");
            expect(items).toHaveLength(OPTIONS.length);
            expect(option(/United Kingdom/)).toHaveAttribute("aria-checked", "true");
            expect(option(/Portugal/)).toHaveAttribute("aria-checked", "false");
            // The code is shown beside each name.
            expect(option(/California/)).toHaveTextContent("California US_CA");
        });

        it("adds what is ticked, in the order it was ticked, and keeps the menu open", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field onChange={onChange} />);
            await user.click(trigger());

            await user.click(option(/Portugal/));
            await user.click(option(/European Union/));

            expect(onChange.mock.calls).toEqual([[["PT"]], [["PT", "EU"]]]);
            // Still open: several can be chosen in a row.
            expect(option(/Portugal/)).toHaveAttribute("aria-checked", "true");
            expect(option(/European Union/)).toHaveAttribute("aria-checked", "true");
        });

        it("lists what is chosen and counts it in a line that is read out when it changes", async () => {
            const user = userEvent.setup();
            render(<Field />);
            await user.click(trigger());
            await user.click(option(/Portugal/));
            await user.click(option(/California/));
            await user.keyboard("{Escape}");

            const list = chosen()!;
            expect(
                within(list)
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["Portugal", "California"]);
            const status = screen.getByText("2 of 10 chosen");
            expect(status).toHaveAttribute("aria-live", "polite");
            expect(trigger()).toHaveTextContent("2 selected");
            expect(trigger()).toHaveAccessibleDescription("2 of 10 chosen");
        });

        it("unticks what is ticked again", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT", "EU"]} onChange={onChange} />);
            await user.click(trigger());
            await user.click(option(/Portugal/));
            expect(onChange).toHaveBeenLastCalledWith(["EU"]);
            expect(option(/Portugal/)).toHaveAttribute("aria-checked", "false");
        });
    });

    describe("with the keyboard alone", () => {
        it("opens from the control, moves through the options, and ticks with Enter and Space", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field onChange={onChange} />);

            await user.tab();
            expect(trigger()).toHaveFocus();
            await user.keyboard("{Enter}");
            // The menu opens with the keyboard on its first option.
            expect(option(/United States/)).toHaveFocus();

            await user.keyboard("{ArrowDown}");
            expect(option(/California/)).toHaveFocus();
            await user.keyboard("{Enter}");
            await user.keyboard("{ArrowDown}");
            expect(option(/United Kingdom/)).toHaveFocus();
            await user.keyboard(" ");

            expect(onChange.mock.calls).toEqual([[["US_CA"]], [["US_CA", "GB"]]]);
            expect(option(/California/)).toHaveAttribute("aria-checked", "true");
        });

        it("finds an option by typing its name", async () => {
            const user = userEvent.setup();
            render(<Field />);
            await user.tab();
            await user.keyboard("{Enter}");
            await user.keyboard("p");
            expect(option(/Portugal/)).toHaveFocus();
        });

        it("closes with Escape and gives the keyboard back to the control", async () => {
            const user = userEvent.setup();
            render(<Field />);
            await user.tab();
            await user.keyboard("{Enter}");
            await user.keyboard("{Escape}");
            expect(screen.queryByRole("menu")).toBeNull();
            expect(trigger()).toHaveFocus();
        });

        it("reaches each chosen jurisdiction's remove button and Clear all by Tab", async () => {
            const user = userEvent.setup();
            render(<Field initial={["PT", "EU"]} />);
            await user.tab();
            expect(trigger()).toHaveFocus();
            await user.tab();
            expect(screen.getByRole("button", { name: "Clear all" })).toHaveFocus();
            await user.tab();
            expect(screen.getByRole("button", { name: "Remove Portugal" })).toHaveFocus();
            await user.tab();
            expect(screen.getByRole("button", { name: "Remove European Union" })).toHaveFocus();
        });
    });

    describe("clearing", () => {
        it("removes one jurisdiction from its own button and keeps the keyboard beside it", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT", "EU", "GB"]} onChange={onChange} />);

            const remove = screen.getByRole("button", { name: "Remove European Union" });
            remove.focus();
            await user.keyboard("{Enter}");

            expect(onChange).toHaveBeenLastCalledWith(["PT", "GB"]);
            expect(screen.queryByRole("button", { name: "Remove European Union" })).toBeNull();
            // Not lost to the top of the page: on the chip that followed.
            expect(screen.getByRole("button", { name: "Remove United Kingdom" })).toHaveFocus();
        });

        it("moves to the chip before when the last one in the row is removed", async () => {
            const user = userEvent.setup();
            render(<Field initial={["PT", "EU"]} />);
            await user.click(screen.getByRole("button", { name: "Remove European Union" }));
            expect(screen.getByRole("button", { name: "Remove Portugal" })).toHaveFocus();
        });

        it("returns to the control, and to the empty state, when the only one is removed", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT"]} onChange={onChange} />);
            await user.click(screen.getByRole("button", { name: "Remove Portugal" }));

            expect(onChange).toHaveBeenLastCalledWith([]);
            expect(chosen()).toBeNull();
            expect(screen.getByText(EMPTY)).toBeInTheDocument();
            expect(trigger()).toHaveFocus();
            expect(trigger()).toHaveTextContent("Select jurisdictions");
        });

        it("clears everything at once and returns to the control", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT", "EU", "GB"]} onChange={onChange} />);
            await user.click(screen.getByRole("button", { name: "Clear all" }));

            expect(onChange).toHaveBeenLastCalledWith([]);
            expect(chosen()).toBeNull();
            expect(screen.getByText(EMPTY)).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
            expect(trigger()).toHaveFocus();
        });
    });

    describe("at the limit", () => {
        it("says so, stops further choices, and still lets one be unticked", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT", "EU"]} max={2} onChange={onChange} />);
            expect(
                screen.getByText("2 of 2 chosen. Remove one to choose another."),
            ).toBeInTheDocument();

            await user.click(trigger());
            expect(option(/United Kingdom/)).toHaveAttribute("aria-disabled", "true");
            expect(option(/Portugal/)).not.toHaveAttribute("aria-disabled");
            await user.click(option(/United Kingdom/));
            expect(onChange).not.toHaveBeenCalled();

            await user.click(option(/Portugal/));
            expect(onChange).toHaveBeenLastCalledWith(["EU"]);
            // With room again, the others can be chosen.
            expect(option(/United Kingdom/)).not.toHaveAttribute("aria-disabled");
        });
    });

    describe("a jurisdiction the registry no longer holds", () => {
        it("is still shown, by its code, and can be removed", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT", "XX"]} onChange={onChange} />);
            await user.click(screen.getByRole("button", { name: "Remove XX" }));
            expect(onChange).toHaveBeenLastCalledWith(["PT"]);
        });
    });

    describe("for somebody who may read but not change", () => {
        it("shows the chosen jurisdictions as names, with nothing to press", () => {
            render(<Field initial={["PT", "EU"]} readOnly />);
            expect(trigger()).toBeDisabled();
            const list = chosen()!;
            expect(
                within(list)
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["Portugal", "European Union"]);
            expect(within(list).queryByRole("button")).toBeNull();
            expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
        });

        it("keeps the empty state when nothing is recorded", () => {
            render(<Field readOnly />);
            expect(screen.getByText(EMPTY)).toBeInTheDocument();
            expect(chosen()).toBeNull();
        });
    });

    describe("while it is held, as during a save", () => {
        it("keeps everything where it is and lets none of it be pressed", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Field initial={["PT", "EU"]} disabled onChange={onChange} />);

            expect(trigger()).toBeDisabled();
            // The same buttons as before the save, so nothing jumps or is
            // announced again: they are only held.
            const remove = screen.getByRole("button", { name: "Remove Portugal" });
            const clear = screen.getByRole("button", { name: "Clear all" });
            expect(remove).toBeDisabled();
            expect(clear).toBeDisabled();
            expect(screen.getByText("2 of 10 chosen")).toBeInTheDocument();

            await user.click(remove);
            await user.click(clear);
            await user.click(trigger());
            expect(onChange).not.toHaveBeenCalled();
            expect(screen.queryByRole("menu")).toBeNull();
        });

        it("says the same thing when empty as it did before the save", () => {
            const { rerender } = render(<Field />);
            const before = screen.getByText(EMPTY);
            rerender(<Field disabled />);
            // The same live line with the same words: nothing new is read out.
            expect(screen.getByText(EMPTY)).toBe(before);
        });
    });

    describe("hit areas and semantics", () => {
        it("uses real buttons that never submit a form", () => {
            render(<Field initial={["PT"]} />);
            for (const button of [
                trigger(),
                screen.getByRole("button", { name: "Remove Portugal" }),
                screen.getByRole("button", { name: "Clear all" }),
            ])
                expect(button).toHaveAttribute("type", "button");
        });

        it("gives the one-line Clear all a target as tall as the minimum", () => {
            render(<Field initial={["PT"]} />);
            expect(screen.getByRole("button", { name: "Clear all" })).toHaveClass("min-h-6");
        });

        it("draws the modal control by default and the settings field when asked", () => {
            const { unmount } = render(<Field />);
            expect(trigger()).toHaveClass("h-10", "liquid-glass-subtle");
            unmount();
            render(
                <>
                    <label htmlFor="defaults">Jurisdictions</label>
                    <JurisdictionMultiSelect
                        id="defaults"
                        surface="settings"
                        value={[]}
                        onChange={() => {}}
                        options={OPTIONS}
                        max={10}
                        emptyText={EMPTY}
                    />
                </>,
            );
            expect(trigger()).toHaveClass("h-9");
            expect(trigger()).not.toHaveClass("liquid-glass-subtle");
        });

        it("indents a subdivision under its country", async () => {
            const user = userEvent.setup();
            render(<Field />);
            await user.click(trigger());
            expect(option(/California/)).toHaveClass("pl-6");
            expect(option(/United States/)).not.toHaveClass("pl-6");
        });
    });
});
