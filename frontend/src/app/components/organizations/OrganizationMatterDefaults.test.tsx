// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    getJurisdictionRegistry,
    setOrgMatterDefaults,
    type JurisdictionRegistry,
    type Org,
    type OrgMatterDefaults,
} from "@/app/lib/mikeApi";
import { clearJurisdictionRegistryCache } from "@/app/hooks/useJurisdictionRegistry";
import { OrganizationMatterDefaults } from "./OrganizationMatterDefaults";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getJurisdictionRegistry: vi.fn(),
    setOrgMatterDefaults: vi.fn(),
}));

const registry: JurisdictionRegistry = {
    jurisdictions: [
        { code: "GB", name: "United Kingdom", kind: "country", parent: null, languages: ["en"] },
        { code: "EU", name: "European Union", kind: "supranational", parent: null, languages: ["en", "fr", "de"] },
        { code: "IE", name: "Ireland", kind: "country", parent: null, languages: ["en", "ga"] },
    ],
    working_languages: [
        { code: "en-GB", name: "British English" },
        { code: "fr-FR", name: "French" },
    ],
    max_jurisdictions: 10,
};

const baseOrg: Org = {
    id: "org-1",
    name: "Elite Law LLP",
    created_by: "owner-1",
    role: "admin",
    default_jurisdictions: [],
    default_working_language: null,
};

/** The section as the settings page holds it: the page keeps the org. */
function Page({
    initial = baseOrg,
    onSaved = () => {},
}: {
    initial?: Org;
    onSaved?: (org: Org) => void;
}) {
    const [org, setOrg] = useState(initial);
    return (
        <OrganizationMatterDefaults
            org={org}
            onSaved={(next) => {
                setOrg(next);
                onSaved(next);
            }}
        />
    );
}

const jurisdictions = () => screen.getByLabelText("Default jurisdictions");
const language = () => screen.getByRole("button", { name: "Default working language" });
const save = () => screen.getByRole("button", { name: "Save defaults" });

async function loaded() {
    await waitFor(() => expect(language()).toBeEnabled());
}

/** A save that stays in flight until the test lets it land. */
function heldSave() {
    let land!: (value: OrgMatterDefaults) => void;
    let fail!: (reason: unknown) => void;
    vi.mocked(setOrgMatterDefaults).mockReturnValue(
        new Promise<OrgMatterDefaults>((resolve, reject) => {
            land = resolve;
            fail = reject;
        }),
    );
    return {
        land: (value: OrgMatterDefaults) => act(async () => land(value)),
        fail: (reason: unknown) => act(async () => fail(reason)),
    };
}

describe("OrganizationMatterDefaults", () => {
    beforeEach(() => {
        clearJurisdictionRegistryCache();
        vi.mocked(getJurisdictionRegistry).mockReset();
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        vi.mocked(setOrgMatterDefaults).mockReset();
    });

    describe("what it shows", () => {
        it("is a labelled section with a labelled control for each default", async () => {
            render(<Page />);
            await loaded();
            const section = screen.getByRole("region", { name: "New Project Defaults" });
            expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(
                "New Project Defaults",
            );
            expect(screen.getByText("Default jurisdictions", { selector: "label" })).toBeVisible();
            expect(jurisdictions().tagName).toBe("BUTTON");
            expect(screen.getByText("Default working language")).toBeVisible();
            expect(language()).toHaveAttribute("id", "org-default-working-language");
            expect(
                screen.getByText(
                    "New projects in this organization start with these. A project can change them, and existing projects stay as they are.",
                ),
            ).toBeInTheDocument();
        });

        it("says so when there are no defaults, and has nothing to save", async () => {
            render(<Page />);
            await loaded();
            expect(
                screen.getByText("No default jurisdictions. New projects start with none."),
            ).toBeInTheDocument();
            expect(language()).toHaveTextContent("Not set");
            expect(
                screen.getByText("New projects start with no working language."),
            ).toBeInTheDocument();
            expect(save()).toBeDisabled();
        });

        it("shows the defaults that are saved", async () => {
            render(
                <Page
                    initial={{
                        ...baseOrg,
                        default_jurisdictions: ["GB", "EU"],
                        default_working_language: "en-GB",
                    }}
                />,
            );
            await loaded();
            expect(jurisdictions()).toHaveTextContent("2 selected");
            expect(
                within(screen.getByRole("list", { name: "Chosen jurisdictions" }))
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["United Kingdom", "European Union"]);
            expect(language()).toHaveTextContent("British English");
            expect(
                screen.getByText(
                    "New projects start with British English as their working language.",
                ),
            ).toBeInTheDocument();
            expect(save()).toBeDisabled();
        });

        it("reads an organization from a server without the fields as having none", async () => {
            const older: Org = {
                id: baseOrg.id,
                name: baseOrg.name,
                created_by: baseOrg.created_by,
                role: baseOrg.role,
            };
            render(<Page initial={older} />);
            await loaded();
            expect(jurisdictions()).toHaveTextContent("Select jurisdictions");
            expect(language()).toHaveTextContent("Not set");
        });

        it("still shows a saved language the list no longer offers, and says to choose another", async () => {
            render(<Page initial={{ ...baseOrg, default_working_language: "xx-XX" }} />);
            await loaded();
            expect(language()).toHaveTextContent("xx-XX");
            expect(
                screen.getByText("This language is no longer offered. Choose another."),
            ).toBeInTheDocument();
        });
    });

    describe("saving", () => {
        it("saves both defaults in one request and hands the page the updated organization", async () => {
            const user = userEvent.setup();
            const onSaved = vi.fn();
            vi.mocked(setOrgMatterDefaults).mockResolvedValue({
                default_jurisdictions: ["GB", "EU"],
                default_working_language: "en-GB",
            });
            render(<Page onSaved={onSaved} />);
            await loaded();

            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /United Kingdom/ }));
            await user.click(screen.getByRole("menuitemcheckbox", { name: /European Union/ }));
            await user.keyboard("{Escape}");
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "British English" }));
            expect(save()).toBeEnabled();
            await user.click(save());

            expect(setOrgMatterDefaults).toHaveBeenCalledTimes(1);
            expect(setOrgMatterDefaults).toHaveBeenCalledWith("org-1", {
                default_jurisdictions: ["GB", "EU"],
                default_working_language: "en-GB",
            });
            expect(await screen.findByText("Saved")).toHaveAttribute("aria-live", "polite");
            expect(onSaved).toHaveBeenCalledWith({
                ...baseOrg,
                default_jurisdictions: ["GB", "EU"],
                default_working_language: "en-GB",
            });
            // In line with what is saved again: nothing more to save.
            expect(save()).toBeDisabled();
        });

        it("sends only the default that changed", async () => {
            const user = userEvent.setup();
            vi.mocked(setOrgMatterDefaults).mockResolvedValue({
                default_jurisdictions: ["GB"],
                default_working_language: "fr-FR",
            });
            render(
                <Page
                    initial={{
                        ...baseOrg,
                        default_jurisdictions: ["GB"],
                        default_working_language: "en-GB",
                    }}
                />,
            );
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "French" }));
            await user.click(save());
            expect(setOrgMatterDefaults).toHaveBeenCalledWith("org-1", {
                default_working_language: "fr-FR",
            });
        });

        it("clears both defaults: an empty list and no language", async () => {
            const user = userEvent.setup();
            vi.mocked(setOrgMatterDefaults).mockResolvedValue({
                default_jurisdictions: [],
                default_working_language: null,
            });
            render(
                <Page
                    initial={{
                        ...baseOrg,
                        default_jurisdictions: ["GB", "EU"],
                        default_working_language: "en-GB",
                    }}
                />,
            );
            await loaded();
            await user.click(screen.getByRole("button", { name: "Clear all" }));
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "Not set" }));
            await user.click(save());

            expect(setOrgMatterDefaults).toHaveBeenCalledWith("org-1", {
                default_jurisdictions: [],
                default_working_language: null,
            });
            await screen.findByText("Saved");
            expect(
                screen.getByText("No default jurisdictions. New projects start with none."),
            ).toBeInTheDocument();
            expect(language()).toHaveTextContent("Not set");
        });

        it("has nothing to save once a change is put back", async () => {
            const user = userEvent.setup();
            render(<Page initial={{ ...baseOrg, default_working_language: "en-GB" }} />);
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "French" }));
            expect(save()).toBeEnabled();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "British English" }));
            expect(save()).toBeDisabled();
            expect(setOrgMatterDefaults).not.toHaveBeenCalled();
        });

        it("is busy while the request is on its way, and holds the jurisdictions as they are", async () => {
            const user = userEvent.setup();
            const request = heldSave();
            render(<Page initial={{ ...baseOrg, default_jurisdictions: ["GB"] }} />);
            await loaded();
            await user.click(screen.getByRole("button", { name: "Remove United Kingdom" }));
            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /Ireland/ }));
            await user.keyboard("{Escape}");
            await user.click(save());

            expect(save()).toBeDisabled();
            expect(save()).toHaveAttribute("aria-busy", "true");
            expect(screen.getByText("Saving...")).toBeInTheDocument();
            expect(jurisdictions()).toBeDisabled();
            expect(screen.getByRole("button", { name: "Remove Ireland" })).toBeDisabled();

            await request.land({
                default_jurisdictions: ["IE"],
                default_working_language: null,
            });
            expect(screen.getByText("Saved")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Remove Ireland" })).toBeEnabled();
            expect(setOrgMatterDefaults).toHaveBeenCalledTimes(1);
        });

        it("keeps a change made while a save is on its way, for the next save", async () => {
            const user = userEvent.setup();
            const request = heldSave();
            render(<Page />);
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "British English" }));
            await user.click(save());
            // Changed again before the first save has landed.
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "French" }));
            // Still one request, still in flight.
            expect(save()).toBeDisabled();
            expect(setOrgMatterDefaults).toHaveBeenCalledTimes(1);

            await request.land({
                default_jurisdictions: [],
                default_working_language: "en-GB",
            });
            // The newer choice is still there, and there is something to save.
            expect(language()).toHaveTextContent("French");
            expect(save()).toBeEnabled();

            vi.mocked(setOrgMatterDefaults).mockResolvedValue({
                default_jurisdictions: [],
                default_working_language: "fr-FR",
            });
            await user.click(save());
            expect(setOrgMatterDefaults).toHaveBeenLastCalledWith("org-1", {
                default_working_language: "fr-FR",
            });
            await waitFor(() => expect(save()).toBeDisabled());
            expect(language()).toHaveTextContent("French");
        });
    });

    describe("when a save is refused or fails", () => {
        it("says what the server said, keeps the change, and saves on a second try", async () => {
            const user = userEvent.setup();
            const onSaved = vi.fn();
            vi.mocked(setOrgMatterDefaults).mockRejectedValueOnce(
                new MikeApiError({
                    status: 403,
                    message: "Only an organization admin can do that.",
                }),
            );
            render(<Page onSaved={onSaved} />);
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "French" }));
            await user.click(save());

            const status = await screen.findByText("Only an organization admin can do that.");
            expect(status).toHaveAttribute("aria-live", "polite");
            expect(status).toHaveClass("text-danger");
            expect(onSaved).not.toHaveBeenCalled();
            expect(language()).toHaveTextContent("French");
            expect(save()).toBeEnabled();

            vi.mocked(setOrgMatterDefaults).mockResolvedValue({
                default_jurisdictions: [],
                default_working_language: "fr-FR",
            });
            await user.click(save());
            await screen.findByText("Saved");
            expect(screen.queryByText("Only an organization admin can do that.")).toBeNull();
        });

        it("shows the validation sentence for a refused value", async () => {
            const user = userEvent.setup();
            vi.mocked(setOrgMatterDefaults).mockRejectedValue(
                new MikeApiError({
                    status: 400,
                    code: "too_many_jurisdictions",
                    message: "Choose at most 10 jurisdictions.",
                }),
            );
            render(<Page />);
            await loaded();
            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /Ireland/ }));
            await user.keyboard("{Escape}");
            await user.click(save());
            expect(await screen.findByText("Choose at most 10 jurisdictions.")).toBeInTheDocument();
        });

        it("says the defaults could not be saved when the failure has nothing to tell", async () => {
            const user = userEvent.setup();
            vi.mocked(setOrgMatterDefaults).mockRejectedValue(new Error("socket hang up"));
            render(<Page />);
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "French" }));
            await user.click(save());
            expect(
                await screen.findByText("The defaults could not be saved. Try again."),
            ).toBeInTheDocument();
            expect(screen.queryByText("socket hang up")).toBeNull();
        });

        it("clears the failure once something is changed", async () => {
            const user = userEvent.setup();
            vi.mocked(setOrgMatterDefaults).mockRejectedValue(new Error("offline"));
            render(<Page />);
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "French" }));
            await user.click(save());
            await screen.findByText("The defaults could not be saved. Try again.");
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "British English" }));
            expect(screen.queryByText("The defaults could not be saved. Try again.")).toBeNull();
        });
    });

    describe("when the organization is read again", () => {
        function Reread({ next }: { next: Org }) {
            const [org, setOrg] = useState(baseOrg);
            return (
                <>
                    <button type="button" onClick={() => setOrg(next)}>
                        reread
                    </button>
                    <OrganizationMatterDefaults org={org} onSaved={setOrg} />
                </>
            );
        }

        it("follows what is saved for a default the admin has not touched", async () => {
            const user = userEvent.setup();
            render(
                <Reread
                    next={{
                        ...baseOrg,
                        default_jurisdictions: ["IE"],
                        default_working_language: "fr-FR",
                    }}
                />,
            );
            await loaded();
            await user.click(screen.getByRole("button", { name: "reread" }));
            expect(screen.getByRole("button", { name: "Remove Ireland" })).toBeInTheDocument();
            expect(language()).toHaveTextContent("French");
            expect(save()).toBeDisabled();
        });

        it("keeps a default the admin has changed, and follows the other", async () => {
            const user = userEvent.setup();
            render(
                <Reread
                    next={{
                        ...baseOrg,
                        default_jurisdictions: ["IE"],
                        default_working_language: "fr-FR",
                    }}
                />,
            );
            await loaded();
            await user.click(language());
            await user.click(screen.getByRole("menuitemradio", { name: "British English" }));
            await user.click(screen.getByRole("button", { name: "reread" }));

            expect(language()).toHaveTextContent("British English");
            expect(screen.getByRole("button", { name: "Remove Ireland" })).toBeInTheDocument();
            expect(save()).toBeEnabled();
        });
    });

    describe("while the lists are on their way", () => {
        it("holds both controls and offers nothing to save", () => {
            vi.mocked(getJurisdictionRegistry).mockReturnValue(new Promise(() => {}));
            render(<Page initial={{ ...baseOrg, default_jurisdictions: ["GB"] }} />);
            expect(jurisdictions()).toBeDisabled();
            expect(language()).toBeDisabled();
            expect(language()).toHaveTextContent("Loading...");
            expect(save()).toBeDisabled();
            // What is saved is shown by its code until the names arrive.
            expect(
                within(screen.getByRole("list", { name: "Chosen jurisdictions" })).getByRole(
                    "listitem",
                ),
            ).toHaveTextContent("GB");
        });
    });

    describe("when the lists cannot be read", () => {
        it("says so, shows what is saved without pretending to load, and loads on Try again", async () => {
            const user = userEvent.setup();
            vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(new Error("offline"));
            render(
                <Page
                    initial={{
                        ...baseOrg,
                        default_jurisdictions: ["GB"],
                        default_working_language: "en-GB",
                    }}
                />,
            );

            const alert = await screen.findByRole("alert");
            expect(alert).toHaveTextContent(
                "The lists of jurisdictions and languages could not be loaded, so the defaults cannot be changed yet.",
            );
            expect(jurisdictions()).toBeDisabled();
            expect(language()).toHaveTextContent("en-GB");
            expect(language()).not.toHaveTextContent("Loading...");
            expect(
                screen.getByText("New projects start with en-GB as their working language."),
            ).toBeInTheDocument();
            expect(save()).toBeDisabled();

            const retry = within(alert).getByRole("button", { name: "Try again" });
            expect(retry).toHaveClass("min-h-6");
            await user.click(retry);

            await waitFor(() => expect(language()).toHaveTextContent("British English"));
            expect(screen.queryByRole("alert")).toBeNull();
            expect(screen.getByRole("button", { name: "Remove United Kingdom" })).toBeEnabled();
        });

        it("says Not set for no saved language", async () => {
            vi.mocked(getJurisdictionRegistry).mockRejectedValue(new Error("offline"));
            render(<Page />);
            await screen.findByRole("alert");
            expect(language()).toHaveTextContent("Not set");
        });
    });

    describe("with the keyboard alone", () => {
        it("reaches the jurisdictions, the language and Save in that order, and saves", async () => {
            const user = userEvent.setup();
            vi.mocked(setOrgMatterDefaults).mockResolvedValue({
                default_jurisdictions: ["GB"],
                default_working_language: null,
            });
            render(<Page />);
            await loaded();

            await user.tab();
            expect(jurisdictions()).toHaveFocus();
            await user.keyboard("{Enter}");
            await user.keyboard("{Enter}");
            await user.keyboard("{Escape}");
            expect(jurisdictions()).toHaveFocus();

            await user.tab(); // Clear all
            await user.tab(); // Remove United Kingdom
            await user.tab();
            expect(language()).toHaveFocus();
            await user.tab();
            expect(save()).toHaveFocus();
            await user.keyboard("{Enter}");

            expect(setOrgMatterDefaults).toHaveBeenCalledWith("org-1", {
                default_jurisdictions: ["GB"],
            });
        });
    });
});
