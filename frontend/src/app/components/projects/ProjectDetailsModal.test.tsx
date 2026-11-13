import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    getJurisdictionRegistry,
    listOrgs,
    type JurisdictionRegistry,
} from "@/app/lib/mikeApi";
import type { Project } from "@/app/components/shared/types";
import { clearJurisdictionRegistryCache } from "@/app/hooks/useJurisdictionRegistry";
import { ProjectDetailsModal } from "./ProjectDetailsModal";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listOrgs: vi.fn(),
    getJurisdictionRegistry: vi.fn(),
}));

vi.mock("./ProjectPracticeField", () => ({
    ProjectPracticeField: ({
        id,
        value,
        disabled,
    }: {
        id: string;
        value: string;
        disabled?: boolean;
    }) => (
        <button id={id} type="button" disabled={disabled}>
            {value || "None"}
        </button>
    ),
}));

// What the jurisdiction fields choose from, as the server lists it.
const registry: JurisdictionRegistry = {
    jurisdictions: [
        { code: "US", name: "United States", kind: "country", parent: null, languages: ["en"] },
        { code: "US_NY", name: "New York", kind: "subdivision", parent: "US", languages: ["en"] },
        { code: "PT", name: "Portugal", kind: "country", parent: null, languages: ["pt"] },
    ],
    working_languages: [
        { code: "en-US", name: "American English" },
        { code: "pt-PT", name: "European Portuguese" },
    ],
    max_jurisdictions: 10,
};

const project = {
    id: "project-1",
    user_id: "user-1",
    org_id: "org-1",
    name: "Matter",
    cm_number: "CM-123",
    practice: "Litigation",
    memory_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
} satisfies Project;

describe("ProjectDetailsModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(listOrgs).mockResolvedValue([
            { id: "org-1", name: "Elite Law LLP" } as never,
        ]);
        clearJurisdictionRegistryCache();
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
    });

    it("shows the current organisation in project details", async () => {
        render(
            <ProjectDetailsModal
                open
                project={project}
                canEdit
                onClose={vi.fn()}
                onSave={vi.fn()}
            />,
        );

        const organisation = await screen.findByLabelText("Organisation");
        expect(organisation).toBeDisabled();
        expect(organisation).toHaveTextContent("Elite Law LLP");
    });

    it("names the organisation from the row when the org list fails", async () => {
        // The select falls back to its raw value when no option matches, so a
        // failed listOrgs used to show the organization's UUID.
        vi.mocked(listOrgs).mockRejectedValue(new Error("network"));
        render(
            <ProjectDetailsModal
                open
                project={{
                    ...project,
                    organization_name: "Elite Law LLP",
                }}
                canEdit
                onClose={vi.fn()}
                onSave={vi.fn()}
            />,
        );

        const organisation = await screen.findByLabelText("Organisation");
        expect(organisation).toHaveTextContent("Elite Law LLP");
        expect(organisation).not.toHaveTextContent("org-1");
    });

    it("reports what an intentional refusal said instead of a generic line", async () => {
        const user = userEvent.setup();
        render(
            <ProjectDetailsModal
                open
                project={project}
                canEdit
                onClose={vi.fn()}
                onSave={vi
                    .fn()
                    .mockRejectedValue(
                        new MikeApiError({
                            status: 409,
                            message: "A project with that CM number exists.",
                        }),
                    )}
            />,
        );

        await user.clear(screen.getByLabelText("Project name"));
        await user.type(screen.getByLabelText("Project name"), "Renamed");
        await user.click(screen.getByRole("button", { name: "Update" }));

        expect(
            await screen.findByText("A project with that CM number exists."),
        ).toBeInTheDocument();
    });

    // Whether a project is public or private is one of its details. Public
    // opens it to the whole organisation; private keeps it to the people it
    // is shared with.
    describe("Public setting", () => {
        const orgProject = (overrides: Partial<Project> = {}) =>
            ({
                ...project,
                organization_name: "Elite Law LLP",
                visibility: "private",
                ...overrides,
            }) as Project;

        it("shows the project's current setting and saves a change with the other details", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={orgProject()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );

            const toggle = screen.getByRole("button", { name: "Public" });
            expect(toggle).toHaveAttribute("aria-pressed", "false");
            expect(
                screen.getByRole("button", { name: "Private" }),
            ).toHaveAttribute("aria-pressed", "true");
            // Nothing changed yet, so nothing to save.
            expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();

            await user.click(toggle);
            expect(
                screen.getByText(
                    "Everyone in Elite Law LLP can open and edit this project.",
                ),
            ).toBeInTheDocument();
            await user.click(screen.getByRole("button", { name: "Update" }));

            expect(onSave).toHaveBeenCalledWith({
                name: "Matter",
                cmNumber: "CM-123",
                practice: "Litigation",
                visibility: "organization",
            });
        });

        it("makes a public project private again", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={orgProject({ visibility: "organization" })}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );

            expect(
                screen.getByRole("button", { name: "Public" }),
            ).toHaveAttribute("aria-pressed", "true");
            await user.click(screen.getByRole("button", { name: "Private" }));
            await user.click(screen.getByRole("button", { name: "Update" }));

            expect(onSave).toHaveBeenCalledWith(
                expect.objectContaining({ visibility: "private" }),
            );
        });

        it("leaves the setting out when only other details changed", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={orgProject()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );

            const name = screen.getByLabelText("Project name");
            await user.clear(name);
            await user.type(name, "Renamed");
            await user.click(screen.getByRole("button", { name: "Update" }));

            expect(onSave).toHaveBeenCalledTimes(1);
            expect(onSave.mock.calls[0][0]).not.toHaveProperty("visibility");
        });

        it("shows the setting, unchangeable, to somebody who cannot edit the project", () => {
            render(
                <ProjectDetailsModal
                    open
                    project={orgProject({ visibility: "organization" })}
                    canEdit={false}
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            const toggle = screen.getByRole("button", { name: "Public" });
            expect(toggle).toHaveAttribute("aria-pressed", "true");
            expect(toggle).toBeDisabled();
            expect(screen.getByRole("button", { name: "Private" })).toBeDisabled();
        });

        it("is not offered for a personal project", () => {
            render(
                <ProjectDetailsModal
                    open
                    project={{ ...project, org_id: null }}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            expect(
                screen.queryByRole("group", { name: "Organisational Access" }),
            ).not.toBeInTheDocument();
        });
    });

    // While the deployment has not switched the profile on (the default),
    // the form is what it was before the profile existed, whatever the
    // project carries.
    describe("while the jurisdiction profile is switched off", () => {
        const recorded = {
            ...project,
            jurisdictions: ["US", "US_NY"],
            governing_law: "US_NY",
            working_language: "en-US",
        } as Project;

        it("shows the fields it always had, and asks the server for no registry", async () => {
            render(
                <ProjectDetailsModal
                    open
                    project={recorded}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            await screen.findByLabelText("Organisation");

            expect(
                Array.from(document.querySelectorAll("label")).map(
                    (label) => label.textContent,
                ),
            ).toEqual(["Project name", "CM number", "Practice", "Organisation"]);
            expect(screen.queryByLabelText("Jurisdictions")).not.toBeInTheDocument();
            expect(screen.queryByLabelText("Governing law")).not.toBeInTheDocument();
            expect(screen.queryByLabelText("Working language")).not.toBeInTheDocument();
            expect(getJurisdictionRegistry).not.toHaveBeenCalled();
        });

        it("keeps the form's own layout, without the scrolling the profile needs", async () => {
            render(
                <ProjectDetailsModal
                    open
                    project={recorded}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            const name = await screen.findByLabelText("Project name");
            const form = name.parentElement?.parentElement;
            expect(form).toHaveClass("flex", "min-h-0", "flex-1", "flex-col", "gap-6", "py-1");
            expect(form).not.toHaveClass("overflow-y-auto");
            expect(document.querySelector("[data-modal-scroll]")).toBeNull();
        });

        it("saves the details without any of the profile", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={recorded}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );
            const name = await screen.findByLabelText("Project name");
            await user.clear(name);
            await user.type(name, "Renamed matter");
            await user.click(screen.getByRole("button", { name: "Update" }));

            await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
            expect(onSave.mock.calls[0][0]).toEqual({
                name: "Renamed matter",
                cmNumber: "CM-123",
                practice: "Litigation",
            });
        });
    });

    // The matter's jurisdiction profile is three more of a project's
    // details: the jurisdictions it is about, the law that governs it and
    // the language it is worked in. They sit beside its practice and are
    // saved with the rest, each only when it changed. Shown only where the
    // deployment has switched the profile on.
    describe("jurisdiction profile", () => {
        beforeEach(() => {
            vi.stubEnv("NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED", "true");
        });
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        const withProfile = (overrides: Partial<Project> = {}) =>
            ({
                ...project,
                jurisdictions: ["US", "US_NY"],
                governing_law: "US_NY",
                working_language: "en-US",
                ...overrides,
            }) as Project;
        const jurisdictions = () => screen.getByLabelText("Jurisdictions");
        const governingLaw = () => screen.getByLabelText("Governing law");
        const workingLanguage = () => screen.getByLabelText("Working language");
        const update = () => screen.getByRole("button", { name: "Update" });
        const loaded = () => waitFor(() => expect(governingLaw()).toBeEnabled());

        it("shows three labelled fields after the practice, with what is recorded", async () => {
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            await loaded();

            expect(jurisdictions()).toHaveTextContent("2 selected");
            expect(
                within(screen.getByRole("list", { name: "Chosen jurisdictions" }))
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["United States", "New York"]);
            expect(governingLaw()).toHaveTextContent("New York US_NY");
            expect(workingLanguage()).toHaveTextContent("American English");

            // In reading order: practice, the three fields, the organisation.
            const labels = Array.from(document.querySelectorAll("label")).map(
                (label) => label.textContent,
            );
            expect(labels).toEqual([
                "Project name",
                "CM number",
                "Practice",
                "Jurisdictions",
                "Governing law",
                "Working language",
                "Organisation",
            ]);
            // Nothing changed yet, so nothing to save.
            expect(update()).toBeDisabled();
        });

        it("scrolls the form inside the dialog, so the added fields do not push the footer out", async () => {
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            await loaded();
            const scroller = jurisdictions().closest("[data-modal-scroll]");
            expect(scroller).toHaveAttribute("data-modal-scroll", "vertical");
            expect(scroller).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
            // Every field is inside it; the Update button is not.
            for (const label of ["Project name", "Working language", "Organisation"])
                expect(scroller).toContainElement(screen.getByLabelText(label));
            expect(scroller).not.toContainElement(update());
        });

        it("starts empty for a project with no profile, and says so", async () => {
            render(
                <ProjectDetailsModal
                    open
                    project={project}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            await loaded();
            expect(jurisdictions()).toHaveTextContent("Select jurisdictions");
            expect(
                screen.getByText(
                    "No jurisdictions chosen. Choose the ones this project's work is about.",
                ),
            ).toBeInTheDocument();
            expect(governingLaw()).toHaveTextContent("Not set");
            expect(workingLanguage()).toHaveTextContent("Not set");
            expect(update()).toBeDisabled();
        });

        it("saves all three when all three are chosen", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={project}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );
            await loaded();

            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /Portugal/ }));
            await user.keyboard("{Escape}");
            await user.click(governingLaw());
            await user.click(screen.getByRole("menuitem", { name: "Portugal PT" }));
            await user.click(workingLanguage());
            await user.click(screen.getByRole("menuitem", { name: "European Portuguese" }));
            expect(update()).toBeEnabled();
            await user.click(update());

            expect(onSave).toHaveBeenCalledWith({
                name: "Matter",
                cmNumber: "CM-123",
                practice: "Litigation",
                jurisdictions: ["PT"],
                governingLaw: "PT",
                workingLanguage: "pt-PT",
            });
            expect(await screen.findByText("Updated")).toBeInTheDocument();
        });

        it("sends only the field that changed", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );
            await loaded();
            await user.click(workingLanguage());
            await user.click(screen.getByRole("menuitem", { name: "European Portuguese" }));
            await user.click(update());

            expect(onSave).toHaveBeenCalledWith({
                name: "Matter",
                cmNumber: "CM-123",
                practice: "Litigation",
                workingLanguage: "pt-PT",
            });
        });

        it("clears what was recorded: an empty list and nulls", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );
            await loaded();
            await user.click(screen.getByRole("button", { name: "Clear all" }));
            await user.click(governingLaw());
            await user.click(screen.getByRole("menuitem", { name: "Not set" }));
            await user.click(workingLanguage());
            await user.click(screen.getByRole("menuitem", { name: "Not set" }));
            await user.click(update());

            expect(onSave).toHaveBeenCalledWith({
                name: "Matter",
                cmNumber: "CM-123",
                practice: "Litigation",
                jurisdictions: [],
                governingLaw: null,
                workingLanguage: null,
            });
        });

        it("has nothing to save once a choice is put back", async () => {
            const user = userEvent.setup();
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            await loaded();
            await user.click(screen.getByRole("button", { name: "Remove New York" }));
            expect(update()).toBeEnabled();
            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /New York/ }));
            await user.keyboard("{Escape}");
            expect(update()).toBeDisabled();
        });

        it("counts a different order of the same jurisdictions as a change", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );
            await loaded();
            await user.click(screen.getByRole("button", { name: "Remove United States" }));
            await user.click(jurisdictions());
            await user.click(screen.getByRole("menuitemcheckbox", { name: /United States/ }));
            await user.keyboard("{Escape}");
            await user.click(update());
            expect(onSave).toHaveBeenCalledWith(
                expect.objectContaining({ jurisdictions: ["US_NY", "US"] }),
            );
        });

        it("keeps the choices and says why when the save is refused", async () => {
            const user = userEvent.setup();
            render(
                <ProjectDetailsModal
                    open
                    project={project}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn().mockRejectedValue(
                        new MikeApiError({
                            status: 400,
                            code: "invalid_jurisdiction",
                            message: "PT is not a supported jurisdiction.",
                        }),
                    )}
                />,
            );
            await loaded();
            await user.click(governingLaw());
            await user.click(screen.getByRole("menuitem", { name: "Portugal PT" }));
            await user.click(update());

            expect(
                await screen.findByText("PT is not a supported jurisdiction."),
            ).toBeInTheDocument();
            expect(governingLaw()).toHaveTextContent("Portugal PT");
            expect(update()).toBeEnabled();
        });

        it("shows the profile, unchangeable, to somebody who cannot edit the project", async () => {
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit={false}
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            await waitFor(() =>
                expect(governingLaw()).toHaveTextContent("New York US_NY"),
            );
            expect(jurisdictions()).toBeDisabled();
            expect(governingLaw()).toBeDisabled();
            expect(workingLanguage()).toBeDisabled();
            expect(workingLanguage()).toHaveTextContent("American English");
            const list = screen.getByRole("list", { name: "Chosen jurisdictions" });
            expect(
                within(list)
                    .getAllByRole("listitem")
                    .map((item) => item.textContent),
            ).toEqual(["United States", "New York"]);
            expect(within(list).queryByRole("button")).not.toBeInTheDocument();
            expect(
                screen.queryByRole("button", { name: "Update" }),
            ).not.toBeInTheDocument();
        });

        it("takes up what is recorded again each time it is opened", async () => {
            const user = userEvent.setup();
            const view = (open: boolean) => (
                <ProjectDetailsModal
                    open={open}
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />
            );
            const { rerender } = render(view(true));
            await loaded();
            await user.click(screen.getByRole("button", { name: "Clear all" }));
            expect(jurisdictions()).toHaveTextContent("Select jurisdictions");

            // Closed without saving, then opened again.
            rerender(view(false));
            rerender(view(true));
            await loaded();
            expect(jurisdictions()).toHaveTextContent("2 selected");
            expect(update()).toBeDisabled();
        });

        it("says so when the lists cannot be read, and the other details still save", async () => {
            const user = userEvent.setup();
            const onSave = vi.fn().mockResolvedValue(undefined);
            vi.mocked(getJurisdictionRegistry).mockRejectedValue(new Error("offline"));
            render(
                <ProjectDetailsModal
                    open
                    project={withProfile()}
                    canEdit
                    onClose={vi.fn()}
                    onSave={onSave}
                />,
            );
            expect(await screen.findByRole("alert")).toHaveTextContent(
                "The lists of jurisdictions and languages could not be loaded, so these three fields cannot be changed yet.",
            );
            expect(jurisdictions()).toBeDisabled();

            const name = screen.getByLabelText("Project name");
            await user.clear(name);
            await user.type(name, "Renamed");
            await user.click(update());
            // The profile was not touched, so it is not sent.
            expect(onSave).toHaveBeenCalledWith({
                name: "Renamed",
                cmNumber: "CM-123",
                practice: "Litigation",
            });
        });
    });
});
