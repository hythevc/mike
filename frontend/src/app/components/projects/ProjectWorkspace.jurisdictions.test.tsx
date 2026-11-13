// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getJurisdictionRegistry,
    getProject,
    updateProject,
    type JurisdictionRegistry,
} from "@/app/lib/mikeApi";
import { clearJurisdictionRegistryCache } from "@/app/hooks/useJurisdictionRegistry";
import type { Project } from "@/app/components/shared/types";
import {
    ProjectWorkspaceProvider,
    useProjectWorkspace,
} from "./ProjectWorkspace";

// The matter's jurisdiction profile in the project workspace: the chips
// under the header, and what saving the details form sends and then shows.

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    useSelectedLayoutSegments: () => [],
}));

vi.mock("@/app/lib/mikeApi", () => ({
    createTabularReview: vi.fn(),
    deleteProject: vi.fn(),
    getJurisdictionRegistry: vi.fn(),
    getProject: vi.fn(),
    getProjectPeople: vi.fn(),
    listProjectChats: vi.fn(),
    setProjectMemoryEnabled: vi.fn(),
    updateProject: vi.fn(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1", email: "user@example.com" } }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { displayName: "User" } }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({ saveChat: vi.fn() }),
}));

vi.mock("./ProjectPageParts", () => ({
    ProjectPageHeader: ({ project }: { project: Project | null }) => (
        <header>{project?.name ?? "Loading"}</header>
    ),
}));
vi.mock("@/app/components/tabular/NewTRModal", () => ({
    NewTRModal: () => null,
}));
vi.mock("@/app/components/popups/ConfirmPopup", () => ({
    ConfirmPopup: () => null,
}));
vi.mock("@/app/components/modals/AccessModal", () => ({
    AccessModal: () => null,
}));
vi.mock("./ProjectMemoryModal", () => ({
    ProjectMemoryModal: () => null,
}));

type DetailsValues = Parameters<
    React.ComponentProps<
        typeof import("./ProjectDetailsModal").ProjectDetailsModal
    >["onSave"]
>[0];

// The details form has its own tests. This stand-in saves whatever the test
// hands it, as the form would after the fields were changed.
const detailsToSave = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./ProjectDetailsModal", () => ({
    ProjectDetailsModal: ({
        onSave,
    }: {
        onSave: (values: DetailsValues) => Promise<void>;
    }) => (
        <button
            type="button"
            onClick={() => void onSave(detailsToSave.current as DetailsValues)}
        >
            Save details
        </button>
    ),
}));

const registry: JurisdictionRegistry = {
    jurisdictions: [
        { code: "BR", name: "Brazil", kind: "country", parent: null, languages: ["pt"] },
        { code: "BR_SP", name: "São Paulo", kind: "subdivision", parent: "BR", languages: ["pt"] },
        { code: "PT", name: "Portugal", kind: "country", parent: null, languages: ["pt"] },
    ],
    working_languages: [{ code: "pt-BR", name: "Brazilian Portuguese" }],
    max_jurisdictions: 10,
};

const loadedProject = (overrides: Partial<Project> = {}) =>
    ({
        id: "project-1",
        name: "Cross-border sale",
        cm_number: "CM-1",
        practice: "Corporate",
        is_owner: true,
        jurisdictions: ["BR", "BR_SP"],
        governing_law: "BR_SP",
        working_language: "pt-BR",
        ...overrides,
    }) as Project;

/** What the rest of the workspace sees of the project. */
function ShowProfile() {
    const { project } = useProjectWorkspace();
    return (
        <output>
            {JSON.stringify({
                jurisdictions: project?.jurisdictions,
                governing_law: project?.governing_law,
                working_language: project?.working_language,
            })}
        </output>
    );
}

function renderWorkspace() {
    return render(
        <ProjectWorkspaceProvider projectId="project-1">
            <ShowProfile />
            <main>Documents</main>
        </ProjectWorkspaceProvider>,
    );
}

const chips = () => screen.queryByRole("list", { name: "Jurisdictions of this project" });
const chipNames = () =>
    within(chips()!)
        .getAllByRole("listitem")
        .map((item) => item.textContent);
const profile = () => JSON.parse(screen.getByRole("status").textContent ?? "{}");

describe("the jurisdiction profile in the project workspace", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearJurisdictionRegistryCache();
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        vi.mocked(getProject).mockResolvedValue(loadedProject() as never);
        detailsToSave.current = null;
    });

    describe("chips under the header", () => {
        it("names the project's jurisdictions, between the header and the page", async () => {
            renderWorkspace();
            await waitFor(() => expect(chipNames()).toEqual(["Brazil", "São Paulo"]));

            const header = screen.getByRole("banner");
            const list = chips()!;
            const page = screen.getByRole("main");
            expect(
                header.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
            expect(
                list.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        });

        it("draws nothing, and reads no registry, for a project with no jurisdictions", async () => {
            vi.mocked(getProject).mockResolvedValue(
                loadedProject({ jurisdictions: [] }) as never,
            );
            renderWorkspace();
            await screen.findByText("Cross-border sale");
            expect(chips()).toBeNull();
            expect(document.querySelector("[data-slot='project-jurisdiction-chips']")).toBeNull();
            expect(getJurisdictionRegistry).not.toHaveBeenCalled();
        });

        it("draws nothing for a project from a server without the field", async () => {
            const older: Partial<Project> = loadedProject();
            delete older.jurisdictions;
            vi.mocked(getProject).mockResolvedValue(older as never);
            renderWorkspace();
            await screen.findByText("Cross-border sale");
            expect(chips()).toBeNull();
            expect(getJurisdictionRegistry).not.toHaveBeenCalled();
        });

        it("draws nothing while the project is loading", () => {
            vi.mocked(getProject).mockReturnValue(new Promise(() => {}));
            renderWorkspace();
            expect(chips()).toBeNull();
            expect(getJurisdictionRegistry).not.toHaveBeenCalled();
        });
    });

    describe("saving the details form", () => {
        it("sends the changed profile fields under the names the server reads", async () => {
            const user = userEvent.setup();
            vi.mocked(updateProject).mockResolvedValue(
                loadedProject({
                    jurisdictions: ["PT"],
                    governing_law: "PT",
                    working_language: null,
                }) as never,
            );
            renderWorkspace();
            await waitFor(() => expect(chips()).not.toBeNull());

            detailsToSave.current = {
                name: "Cross-border sale",
                cmNumber: "CM-1",
                practice: "Corporate",
                jurisdictions: ["PT"],
                governingLaw: "PT",
                workingLanguage: null,
            } satisfies DetailsValues;
            await user.click(screen.getByRole("button", { name: "Save details" }));

            expect(updateProject).toHaveBeenCalledWith("project-1", {
                name: "Cross-border sale",
                cm_number: "CM-1",
                practice: "Corporate",
                jurisdictions: ["PT"],
                governing_law: "PT",
                working_language: null,
            });
            // The header and the rest of the workspace show what was saved.
            await waitFor(() => expect(chipNames()).toEqual(["Portugal"]));
            expect(profile()).toEqual({
                jurisdictions: ["PT"],
                governing_law: "PT",
                working_language: null,
            });
        });

        it("sends none of the profile when the form did not change it", async () => {
            const user = userEvent.setup();
            vi.mocked(updateProject).mockResolvedValue(
                loadedProject({ name: "Renamed" }) as never,
            );
            renderWorkspace();
            await waitFor(() => expect(chips()).not.toBeNull());

            detailsToSave.current = {
                name: "Renamed",
                cmNumber: "CM-1",
                practice: "Corporate",
            } satisfies DetailsValues;
            await user.click(screen.getByRole("button", { name: "Save details" }));

            expect(updateProject).toHaveBeenCalledWith("project-1", {
                name: "Renamed",
                cm_number: "CM-1",
                practice: "Corporate",
            });
            await screen.findByText("Renamed");
            expect(chipNames()).toEqual(["Brazil", "São Paulo"]);
        });

        it("clears the profile with an empty list and nulls, and takes the chips away", async () => {
            const user = userEvent.setup();
            vi.mocked(updateProject).mockResolvedValue(
                loadedProject({
                    jurisdictions: [],
                    governing_law: null,
                    working_language: null,
                }) as never,
            );
            renderWorkspace();
            await waitFor(() => expect(chips()).not.toBeNull());

            detailsToSave.current = {
                name: "Cross-border sale",
                cmNumber: "CM-1",
                practice: "Corporate",
                jurisdictions: [],
                governingLaw: null,
                workingLanguage: null,
            } satisfies DetailsValues;
            await user.click(screen.getByRole("button", { name: "Save details" }));

            expect(updateProject).toHaveBeenCalledWith(
                "project-1",
                expect.objectContaining({
                    jurisdictions: [],
                    governing_law: null,
                    working_language: null,
                }),
            );
            await waitFor(() => expect(chips()).toBeNull());
            expect(profile()).toEqual({
                jurisdictions: [],
                governing_law: null,
                working_language: null,
            });
        });

        it("keeps what was shown when the response does not carry the profile", async () => {
            const user = userEvent.setup();
            const older: Partial<Project> = loadedProject({ name: "Renamed" });
            delete older.jurisdictions;
            delete older.governing_law;
            delete older.working_language;
            vi.mocked(updateProject).mockResolvedValue(older as never);
            renderWorkspace();
            await waitFor(() => expect(chips()).not.toBeNull());

            detailsToSave.current = {
                name: "Renamed",
                cmNumber: "CM-1",
                practice: "Corporate",
            } satisfies DetailsValues;
            await user.click(screen.getByRole("button", { name: "Save details" }));

            await screen.findByText("Renamed");
            expect(profile()).toEqual({
                jurisdictions: ["BR", "BR_SP"],
                governing_law: "BR_SP",
                working_language: "pt-BR",
            });
        });

        it("sends nothing for somebody who does not own the project", async () => {
            const user = userEvent.setup();
            vi.mocked(getProject).mockResolvedValue(
                loadedProject({ is_owner: false, access_role: "editor" } as Partial<Project>) as never,
            );
            renderWorkspace();
            await waitFor(() => expect(chips()).not.toBeNull());

            detailsToSave.current = {
                name: "Cross-border sale",
                cmNumber: "CM-1",
                practice: "Corporate",
                jurisdictions: ["PT"],
            } satisfies DetailsValues;
            await user.click(screen.getByRole("button", { name: "Save details" }));

            // Told why, in the workspace's own words, and nothing is sent.
            expect(
                await screen.findByText("Only an owner can edit project details."),
            ).toBeInTheDocument();
            expect(updateProject).not.toHaveBeenCalled();
            expect(chipNames()).toEqual(["Brazil", "São Paulo"]);
        });
    });
});
