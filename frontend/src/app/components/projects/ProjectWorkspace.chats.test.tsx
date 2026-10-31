// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProject, listProjectChats, MikeApiError } from "@/app/lib/mikeApi";
import ProjectAssistantPage from "@/app/(pages)/projects/[id]/assistant/page";
import { ProjectWorkspaceProvider } from "./ProjectWorkspace";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSelectedLayoutSegments: () => ["assistant"],
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getProject: vi.fn(),
    listProjectChats: vi.fn(),
    deleteChat: vi.fn(),
    renameChat: vi.fn(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1", email: "user@example.com" } }),
}));

vi.mock("./ProjectPageParts", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./ProjectPageParts")>()),
    ProjectPageHeader: () => null,
}));
vi.mock("./ProjectDetailsModal", () => ({ ProjectDetailsModal: () => null }));
vi.mock("./ProjectMemoryModal", () => ({ ProjectMemoryModal: () => null }));
vi.mock("@/app/components/tabular/NewTRModal", () => ({ NewTRModal: () => null }));

const project = {
    id: "project-1",
    name: "Acme merger",
    is_owner: true,
    access_role: "owner",
    documents: [],
    folders: [],
};

async function renderChatsPage() {
    const params = Promise.resolve({ id: "project-1" });
    // The page reads its params with use(), which suspends once.
    await act(async () => {
        render(
            <ProjectWorkspaceProvider projectId="project-1">
                <Suspense fallback={null}>
                    <ProjectAssistantPage params={params} />
                </Suspense>
            </ProjectWorkspaceProvider>,
        );
    });
}

describe("project chat list", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            "matchMedia",
            vi.fn().mockReturnValue({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }),
        );
        vi.mocked(getProject).mockResolvedValue(
            project as unknown as Awaited<ReturnType<typeof getProject>>,
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("shows the error state with Try again when the chat list fails, not an empty project", async () => {
        vi.mocked(listProjectChats)
            .mockRejectedValueOnce(new MikeApiError({ message: "boom", status: 500 }))
            .mockResolvedValueOnce([
                {
                    id: "chat-1",
                    project_id: "project-1",
                    user_id: "user-1",
                    title: "Diligence questions",
                    created_at: "2026-10-01T00:00:00.000Z",
                    is_owner: true,
                    access_role: "owner",
                },
            ]);
        const user = userEvent.setup();
        await renderChatsPage();

        expect(
            await screen.findByText("Couldn't load this project's chats"),
        ).toBeInTheDocument();
        expect(
            screen.getByText("Something went wrong on our side. Try again."),
        ).toBeInTheDocument();
        // Not the first-run invitation an empty list would show.
        expect(
            screen.queryByRole("button", { name: "Create" }),
        ).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Try again" }));

        expect(
            await screen.findByText("Diligence questions"),
        ).toBeInTheDocument();
        expect(listProjectChats).toHaveBeenCalledTimes(2);
        expect(
            screen.queryByText("Couldn't load this project's chats"),
        ).not.toBeInTheDocument();
    });

    it("still offers a first chat when the project really has none", async () => {
        vi.mocked(listProjectChats).mockResolvedValue([]);
        await renderChatsPage();

        expect(
            await screen.findByRole("button", { name: "Create" }),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.queryByText("Couldn't load this project's chats"),
            ).not.toBeInTheDocument(),
        );
    });
});
