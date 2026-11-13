// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { updateProject } from "@/app/lib/mikeApi";
import { usePaginatedProjects } from "@/app/hooks/usePaginatedProjects";
import type { Project } from "@/app/components/shared/types";
import { ProjectsOverview } from "./ProjectsOverview";

// The details form can be opened from a row of the projects list as well as
// from inside a project. What this pins: the row hands the form its
// jurisdiction profile, and a save from here sends the profile on, instead
// of reporting "Updated" for fields that were never sent.

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/projects",
}));
vi.mock("@/app/lib/mikeApi", () => ({
    deleteProject: vi.fn(async () => {}),
    setProjectMemoryEnabled: vi.fn(),
    updateProject: vi.fn(),
    getProjectFilterOptions: vi.fn(async () => ({
        practices: [],
        owners: [],
    })),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "me", email: "me@firm.test" } }),
}));
vi.mock("./NewProjectModal", () => ({ NewProjectModal: () => null }));
vi.mock("@/app/hooks/usePaginatedProjects", () => ({
    usePaginatedProjects: vi.fn(),
}));

type DetailsValues = Parameters<
    React.ComponentProps<
        typeof import("./ProjectDetailsModal").ProjectDetailsModal
    >["onSave"]
>[0];

// The form has its own tests. This stand-in shows the profile of the project
// it was handed and saves whatever the test gives it.
const detailsToSave = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./ProjectDetailsModal", () => ({
    ProjectDetailsModal: ({
        open,
        project,
        onSave,
    }: {
        open: boolean;
        project: Project | null;
        onSave: (values: DetailsValues) => Promise<void>;
    }) =>
        open && project ? (
            <div role="dialog" aria-label="Details">
                <output>
                    {JSON.stringify({
                        jurisdictions: project.jurisdictions,
                        governing_law: project.governing_law,
                        working_language: project.working_language,
                    })}
                </output>
                <button
                    type="button"
                    onClick={() =>
                        void onSave(detailsToSave.current as DetailsValues)
                    }
                >
                    Save details
                </button>
            </div>
        ) : null,
}));

const row = {
    id: "project-1",
    user_id: "me",
    name: "Cross-border sale",
    cm_number: "CM-1",
    practice: "Corporate",
    access_role: "owner",
    jurisdictions: ["GB", "EU"],
    governing_law: "GB",
    working_language: "en-GB",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
} as Project;

const setProjects = vi.fn();

function mockRows(rows: Project[]) {
    vi.mocked(usePaginatedProjects).mockReturnValue({
        projects: rows,
        setProjects,
        loading: false,
        loadingMore: false,
        hasMore: false,
        error: null,
        loadMoreError: null,
        loadMore: vi.fn(),
        retry: vi.fn(),
        selectedProjectIds: ["project-1"],
        setSelectedProjectIds: vi.fn(),
        selectAllMatching: vi.fn(),
        selectingAll: false,
        getProjectOwnerId: () => "me",
    } as unknown as ReturnType<typeof usePaginatedProjects>);
}

async function openDetails(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit details" }));
    return screen.findByRole("dialog", { name: "Details" });
}

const shownProfile = () => JSON.parse(screen.getByRole("status").textContent ?? "{}");

describe("the jurisdiction profile from the projects list", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        detailsToSave.current = null;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        mockRows([row]);
    });

    it("hands the details form the row's profile", async () => {
        const user = userEvent.setup();
        render(<ProjectsOverview />);
        await openDetails(user);
        expect(shownProfile()).toEqual({
            jurisdictions: ["GB", "EU"],
            governing_law: "GB",
            working_language: "en-GB",
        });
    });

    it("sends the changed profile fields under the names the server reads", async () => {
        const user = userEvent.setup();
        vi.mocked(updateProject).mockResolvedValue({
            ...row,
            jurisdictions: ["IE"],
            governing_law: null,
            working_language: "en-GB",
        } as never);
        render(<ProjectsOverview />);
        await openDetails(user);

        detailsToSave.current = {
            name: "Cross-border sale",
            cmNumber: "CM-1",
            practice: "Corporate",
            jurisdictions: ["IE"],
            governingLaw: null,
        } satisfies DetailsValues;
        await user.click(screen.getByRole("button", { name: "Save details" }));

        expect(updateProject).toHaveBeenCalledWith("project-1", {
            name: "Cross-border sale",
            cm_number: "CM-1",
            practice: "Corporate",
            jurisdictions: ["IE"],
            governing_law: null,
        });
        // The form now holds what was saved, so it has nothing left to save.
        await waitFor(() =>
            expect(shownProfile()).toEqual({
                jurisdictions: ["IE"],
                governing_law: null,
                working_language: "en-GB",
            }),
        );
        // And so does the row in the list.
        const update = setProjects.mock.calls.at(-1)?.[0] as (rows: Project[]) => Project[];
        expect(update([row])[0]).toMatchObject({
            jurisdictions: ["IE"],
            governing_law: null,
        });
    });

    it("sends the working language too, and a cleared list as an empty one", async () => {
        const user = userEvent.setup();
        vi.mocked(updateProject).mockResolvedValue({
            ...row,
            jurisdictions: [],
            working_language: "fr-FR",
        } as never);
        render(<ProjectsOverview />);
        await openDetails(user);

        detailsToSave.current = {
            name: "Cross-border sale",
            cmNumber: "CM-1",
            practice: "Corporate",
            jurisdictions: [],
            workingLanguage: "fr-FR",
        } satisfies DetailsValues;
        await user.click(screen.getByRole("button", { name: "Save details" }));

        expect(updateProject).toHaveBeenCalledWith("project-1", {
            name: "Cross-border sale",
            cm_number: "CM-1",
            practice: "Corporate",
            jurisdictions: [],
            working_language: "fr-FR",
        });
    });

    it("sends none of the profile when the form did not change it", async () => {
        const user = userEvent.setup();
        vi.mocked(updateProject).mockResolvedValue({ ...row, name: "Renamed" } as never);
        render(<ProjectsOverview />);
        await openDetails(user);

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
    });
});
