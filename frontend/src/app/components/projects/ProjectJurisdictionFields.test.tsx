// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getJurisdictionRegistry,
    type JurisdictionRegistry,
} from "@/app/lib/mikeApi";
import { clearJurisdictionRegistryCache } from "@/app/hooks/useJurisdictionRegistry";
import {
    ProjectJurisdictionFields,
    type ProjectJurisdictionDraft,
} from "./ProjectJurisdictionFields";

vi.mock("@/app/lib/mikeApi", () => ({
    getJurisdictionRegistry: vi.fn(),
}));

const registry: JurisdictionRegistry = {
    jurisdictions: [
        { code: "US", name: "United States", kind: "country", parent: null, languages: ["en"] },
        { code: "US_NY", name: "New York", kind: "subdivision", parent: "US", languages: ["en"] },
        { code: "PT", name: "Portugal", kind: "country", parent: null, languages: ["pt"] },
        { code: "EU", name: "European Union", kind: "supranational", parent: null, languages: ["en", "fr", "de"] },
    ],
    working_languages: [
        { code: "en-GB", name: "British English" },
        { code: "pt-PT", name: "European Portuguese" },
    ],
    max_jurisdictions: 10,
};

const EMPTY: ProjectJurisdictionDraft = {
    jurisdictions: [],
    governingLaw: null,
    workingLanguage: null,
};

/** The fields with their own state, as the details form holds them. */
function Form({
    initial = EMPTY,
    disabled = false,
    readOnly = false,
    onChange = () => {},
}: {
    initial?: ProjectJurisdictionDraft;
    disabled?: boolean;
    readOnly?: boolean;
    onChange?: (next: ProjectJurisdictionDraft) => void;
}) {
    const [value, setValue] = useState(initial);
    return (
        <ProjectJurisdictionFields
            idPrefix="details"
            value={value}
            onChange={(next) => {
                setValue(next);
                onChange(next);
            }}
            disabled={disabled}
            readOnly={readOnly}
        />
    );
}

const jurisdictions = () => screen.getByLabelText("Jurisdictions");
const governingLaw = () => screen.getByLabelText("Governing law");
const workingLanguage = () => screen.getByLabelText("Working language");

async function loaded() {
    // The controls unlock once the registry has arrived.
    await vi.waitFor(() => expect(governingLaw()).toBeEnabled());
}

describe("ProjectJurisdictionFields", () => {
    beforeEach(() => {
        clearJurisdictionRegistryCache();
        vi.mocked(getJurisdictionRegistry).mockReset();
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
    });

    describe("labels", () => {
        it("gives each of the three fields a visible label that names its control", async () => {
            render(<Form />);
            await loaded();
            for (const [label, id] of [
                ["Jurisdictions", "details-jurisdictions"],
                ["Governing law", "details-governing-law"],
                ["Working language", "details-working-language"],
            ]) {
                const text = screen.getByText(label, { selector: "label" });
                expect(text).toBeVisible();
                expect(text).toHaveAttribute("for", id);
                expect(screen.getByLabelText(label)).toHaveAttribute("id", id);
                expect(screen.getByLabelText(label).tagName).toBe("BUTTON");
            }
        });
    });

    describe("the empty state", () => {
        it("says nothing is chosen and what the field is for, and both selects read Not set", async () => {
            render(<Form />);
            await loaded();
            expect(jurisdictions()).toHaveTextContent("Select jurisdictions");
            expect(
                screen.getByText(
                    "No jurisdictions chosen. Choose the ones this project's work is about.",
                ),
            ).toBeInTheDocument();
            expect(screen.queryByRole("list", { name: "Chosen jurisdictions" })).toBeNull();
            expect(governingLaw()).toHaveTextContent("Not set");
            expect(workingLanguage()).toHaveTextContent("Not set");
        });
    });

    describe("choosing", () => {
        it("adds jurisdictions from the registry and reports the whole profile each time", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form onChange={onChange} />);
            await loaded();

            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /Portugal/ }));
            await user.click(screen.getByRole("menuitemcheckbox", { name: /European Union/ }));
            await user.keyboard("{Escape}");

            expect(onChange).toHaveBeenLastCalledWith({
                jurisdictions: ["PT", "EU"],
                governingLaw: null,
                workingLanguage: null,
            });
            const list = screen.getByRole("list", { name: "Chosen jurisdictions" });
            expect(
                within(list)
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["Portugal", "European Union"]);
        });

        it("chooses a governing law by name, showing its code beside it", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form onChange={onChange} />);
            await loaded();

            await user.click(governingLaw());
            await user.click(screen.getByRole("menuitem", { name: "New York US_NY" }));

            expect(onChange).toHaveBeenLastCalledWith({
                jurisdictions: [],
                governingLaw: "US_NY",
                workingLanguage: null,
            });
            expect(governingLaw()).toHaveTextContent("New York US_NY");
        });

        it("chooses a working language from the response-language list", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form onChange={onChange} />);
            await loaded();

            await user.click(workingLanguage());
            expect(
                screen.getAllByRole("menuitem").map((item) => item.textContent),
            ).toEqual(["Not set", "British English", "European Portuguese"]);
            await user.click(screen.getByRole("menuitem", { name: "European Portuguese" }));

            expect(onChange).toHaveBeenLastCalledWith({
                jurisdictions: [],
                governingLaw: null,
                workingLanguage: "pt-PT",
            });
            expect(workingLanguage()).toHaveTextContent("European Portuguese");
        });

        it("offers every registry jurisdiction as a governing law, after Not set", async () => {
            const user = userEvent.setup();
            render(<Form />);
            await loaded();
            await user.click(governingLaw());
            expect(
                screen.getAllByRole("menuitem").map((item) => item.textContent),
            ).toEqual([
                "Not set",
                "United States US",
                "New York US_NY",
                "Portugal PT",
                "European Union EU",
            ]);
        });

        it("works from the keyboard alone", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form onChange={onChange} />);
            await loaded();

            await user.tab();
            expect(jurisdictions()).toHaveFocus();
            await user.tab();
            expect(governingLaw()).toHaveFocus();
            await user.keyboard("{Enter}");
            await user.keyboard("{ArrowDown}");
            await user.keyboard("{Enter}");
            expect(onChange).toHaveBeenLastCalledWith(
                expect.objectContaining({ governingLaw: "US" }),
            );
            // Choosing closes the menu and hands the keyboard back.
            expect(governingLaw()).toHaveFocus();
            await user.tab();
            expect(workingLanguage()).toHaveFocus();
        });
    });

    describe("clearing", () => {
        const set: ProjectJurisdictionDraft = {
            jurisdictions: ["US", "US_NY"],
            governingLaw: "US_NY",
            workingLanguage: "en-GB",
        };

        it("shows what is recorded", async () => {
            render(<Form initial={set} />);
            await loaded();
            expect(jurisdictions()).toHaveTextContent("2 selected");
            expect(governingLaw()).toHaveTextContent("New York US_NY");
            expect(workingLanguage()).toHaveTextContent("British English");
        });

        it("clears the governing law with Not set", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form initial={set} onChange={onChange} />);
            await loaded();
            await user.click(governingLaw());
            await user.click(screen.getByRole("menuitem", { name: "Not set" }));
            expect(onChange).toHaveBeenLastCalledWith({ ...set, governingLaw: null });
            expect(governingLaw()).toHaveTextContent("Not set");
        });

        it("clears the working language with Not set", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form initial={set} onChange={onChange} />);
            await loaded();
            await user.click(workingLanguage());
            await user.click(screen.getByRole("menuitem", { name: "Not set" }));
            expect(onChange).toHaveBeenLastCalledWith({ ...set, workingLanguage: null });
        });

        it("clears the jurisdictions, back to the empty state, leaving the other two", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form initial={set} onChange={onChange} />);
            await loaded();
            await user.click(screen.getByRole("button", { name: "Clear all" }));
            expect(onChange).toHaveBeenLastCalledWith({ ...set, jurisdictions: [] });
            expect(
                screen.getByText(
                    "No jurisdictions chosen. Choose the ones this project's work is about.",
                ),
            ).toBeInTheDocument();
        });

        it("removes one jurisdiction and leaves the rest", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Form initial={set} onChange={onChange} />);
            await loaded();
            await user.click(screen.getByRole("button", { name: "Remove United States" }));
            expect(onChange).toHaveBeenLastCalledWith({ ...set, jurisdictions: ["US_NY"] });
        });
    });

    describe("while the registry is on its way", () => {
        function pending() {
            let resolve!: (value: JurisdictionRegistry) => void;
            vi.mocked(getJurisdictionRegistry).mockReturnValue(
                new Promise((done) => {
                    resolve = done;
                }),
            );
            return (value: JurisdictionRegistry) => act(async () => resolve(value));
        }

        it("has the three labelled controls in place, held, and says it is loading", () => {
            pending();
            const { container } = render(<Form />);
            expect(jurisdictions()).toBeDisabled();
            expect(governingLaw()).toBeDisabled();
            expect(workingLanguage()).toBeDisabled();
            expect(governingLaw()).toHaveTextContent("Loading...");
            expect(workingLanguage()).toHaveTextContent("Loading...");
            expect(
                container.querySelector("[data-slot='project-jurisdiction-fields']"),
            ).toHaveAttribute("aria-busy", "true");
        });

        it("shows what is recorded by its codes until the names arrive", async () => {
            const arrive = pending();
            const { container } = render(
                <Form
                    initial={{
                        jurisdictions: ["PT"],
                        governingLaw: "PT",
                        workingLanguage: "pt-PT",
                    }}
                />,
            );
            const list = screen.getByRole("list", { name: "Chosen jurisdictions" });
            expect(within(list).getByRole("listitem")).toHaveTextContent("PT");
            expect(governingLaw()).toHaveTextContent("PT");
            expect(workingLanguage()).toHaveTextContent("pt-PT");

            await arrive(registry);
            expect(screen.getByRole("button", { name: "Remove Portugal" })).toBeEnabled();
            expect(governingLaw()).toHaveTextContent("Portugal PT");
            expect(workingLanguage()).toHaveTextContent("European Portuguese");
            expect(
                container.querySelector("[data-slot='project-jurisdiction-fields']"),
            ).toHaveAttribute("aria-busy", "false");
        });

        // One control per run: two menus that open together close each
        // other, which would hide a press that was remembered.
        it.each([
            ["Jurisdictions", jurisdictions],
            ["Governing law", governingLaw],
            ["Working language", workingLanguage],
        ])(
            "forgets a press on %s while it is held, so no menu springs open when it arrives",
            async (_label, control) => {
                const user = userEvent.setup();
                const arrive = pending();
                render(<Form />);
                await user.click(control());
                expect(screen.queryByRole("menu")).toBeNull();
                expect(control()).not.toHaveAttribute("aria-expanded", "true");

                await arrive(registry);
                expect(control()).toBeEnabled();
                expect(screen.queryByRole("menu")).toBeNull();
                expect(control()).toHaveAttribute("aria-expanded", "false");

                // And it opens as usual once it can be used.
                await user.click(control());
                expect(screen.getByRole("menu")).toBeInTheDocument();
            },
        );
    });

    describe("when the registry cannot be read", () => {
        it("says so, keeps what is recorded on screen, and loads on Try again", async () => {
            const user = userEvent.setup();
            vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(new Error("offline"));
            render(
                <Form
                    initial={{
                        jurisdictions: ["PT"],
                        governingLaw: "PT",
                        workingLanguage: null,
                    }}
                />,
            );

            const alert = await screen.findByRole("alert");
            expect(alert).toHaveTextContent(
                "The lists of jurisdictions and languages could not be loaded, so these three fields cannot be changed yet.",
            );
            expect(jurisdictions()).toBeDisabled();
            expect(governingLaw()).toBeDisabled();
            expect(governingLaw()).toHaveTextContent("PT");
            expect(
                within(screen.getByRole("list", { name: "Chosen jurisdictions" })).getByRole(
                    "listitem",
                ),
            ).toHaveTextContent("PT");

            const retry = within(alert).getByRole("button", { name: "Try again" });
            expect(retry).toHaveClass("min-h-6");
            await user.click(retry);

            await loaded();
            expect(screen.queryByRole("alert")).toBeNull();
            expect(governingLaw()).toHaveTextContent("Portugal PT");
            expect(getJurisdictionRegistry).toHaveBeenCalledTimes(2);
        });
    });

    describe("for somebody who may read the profile but not change it", () => {
        it("shows the three values with nothing that can be changed", async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(
                <Form
                    readOnly
                    onChange={onChange}
                    initial={{
                        jurisdictions: ["US", "US_NY"],
                        governingLaw: "US_NY",
                        workingLanguage: "en-GB",
                    }}
                />,
            );
            await vi.waitFor(() =>
                expect(governingLaw()).toHaveTextContent("New York US_NY"),
            );
            expect(jurisdictions()).toBeDisabled();
            expect(governingLaw()).toBeDisabled();
            expect(workingLanguage()).toBeDisabled();
            expect(workingLanguage()).toHaveTextContent("British English");
            const list = screen.getByRole("list", { name: "Chosen jurisdictions" });
            expect(
                within(list)
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["United States", "New York"]);
            expect(within(list).queryByRole("button")).toBeNull();
            expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();

            await user.click(jurisdictions());
            await user.click(governingLaw());
            expect(screen.queryByRole("menu")).toBeNull();
            expect(onChange).not.toHaveBeenCalled();
        });

        it("says nothing is recorded, without inviting a choice", async () => {
            render(<Form readOnly />);
            await vi.waitFor(() => expect(governingLaw()).toHaveTextContent("Not set"));
            expect(
                screen.getByText("No jurisdictions are recorded for this project."),
            ).toBeInTheDocument();
            expect(screen.queryByText(/Choose the ones/)).toBeNull();
        });
    });

    describe("while the form is being saved", () => {
        it("holds the controls without changing what they show or say", async () => {
            const { rerender } = render(
                <Form
                    initial={{
                        jurisdictions: ["PT"],
                        governingLaw: null,
                        workingLanguage: null,
                    }}
                />,
            );
            await loaded();
            const status = screen.getByText("1 of 10 chosen");

            rerender(
                <Form
                    disabled
                    initial={{
                        jurisdictions: ["PT"],
                        governingLaw: null,
                        workingLanguage: null,
                    }}
                />,
            );
            expect(jurisdictions()).toBeDisabled();
            expect(governingLaw()).toBeDisabled();
            expect(workingLanguage()).toBeDisabled();
            expect(screen.getByRole("button", { name: "Remove Portugal" })).toBeDisabled();
            expect(screen.getByText("1 of 10 chosen")).toBe(status);
        });

        it("forgets a press made during the save", async () => {
            const user = userEvent.setup();
            const { rerender } = render(<Form disabled />);
            await vi.waitFor(() => expect(governingLaw()).toHaveTextContent("Not set"));
            await user.click(governingLaw());
            rerender(<Form />);
            expect(governingLaw()).toBeEnabled();
            expect(screen.queryByRole("menu")).toBeNull();
        });

        it("opens only one of the two selects at a time", async () => {
            const user = userEvent.setup();
            render(<Form />);
            await loaded();
            await user.click(governingLaw());
            expect(governingLaw()).toHaveAttribute("aria-expanded", "true");
            await user.keyboard("{Escape}");
            expect(governingLaw()).toHaveAttribute("aria-expanded", "false");
            await user.click(workingLanguage());
            expect(workingLanguage()).toHaveAttribute("aria-expanded", "true");
            expect(governingLaw()).toHaveAttribute("aria-expanded", "false");
            expect(screen.getAllByRole("menu")).toHaveLength(1);
        });
    });
});
