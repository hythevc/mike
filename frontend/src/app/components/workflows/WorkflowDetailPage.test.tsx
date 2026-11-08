import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    deleteWorkflowShare,
    duplicateBuiltInWorkflow,
    getWorkflow,
    getWorkflowPeople,
    listWorkflowShares,
    MikeApiError,
    shareWorkflow,
    updateWorkflow,
} from "@/app/lib/mikeApi";
import type { Workflow } from "../shared/types";
import { WorkflowDetailPage } from "./WorkflowDetailPage";

const useItemWorkspace = vi.hoisted(() => vi.fn());
vi.mock("@/app/hooks/useItemWorkspace", () => ({ useItemWorkspace }));

const routerPush = vi.hoisted(() => vi.fn());

// `importOriginal` keeps the real `MikeApiError`: `userFacingApiError`
// decides with `instanceof`, so a stand-in class would make every 4xx look
// like an unexpected failure.
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    deleteWorkflow: vi.fn(),
    deleteWorkflowShare: vi.fn(),
    duplicateBuiltInWorkflow: vi.fn(),
    getWorkflow: vi.fn(),
    getWorkflowPeople: vi.fn(),
    listWorkflowShares: vi.fn(),
    shareWorkflow: vi.fn(),
    updateWorkflow: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: routerPush }),
    useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "me", email: "me@firm.test" } }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { practiceAreas: [] } }),
}));
vi.mock("@/app/hooks/useQueryParamTab", () => ({
    useQueryParamTab: () => ["prompt", vi.fn()],
}));

vi.mock("@/app/components/ui/markdown-editor", () => ({
    MarkdownEditor: () => null,
}));
vi.mock("./WorkflowAssets", () => ({
    WorkflowAssets: () => null,
}));
vi.mock("@/app/components/workflows/UseWorkflowModal", () => ({
    UseWorkflowModal: () => null,
}));
vi.mock("@/app/components/workflows/NewWorkflowModal", () => ({
    NewWorkflowModal: () => null,
}));
vi.mock("@/app/components/modals/AddDocumentsModal", () => ({
    AddDocumentsModal: () => null,
}));

const workflow = {
    id: "workflow-1",
    is_owner: true,
    access_role: "owner",
    org_id: null,
    metadata: {
        title: "Contract Intake",
        type: "assistant",
        language: "English",
        practice: null,
        jurisdictions: null,
    },
    skill_md: "",
} as unknown as Workflow;

function people() {
    return Promise.resolve({
        owner: {
            user_id: "me",
            email: "me@firm.test",
            display_name: "Me",
            role: "owner" as const,
        },
        members: [
            {
                email: "counsel@firm.test",
                display_name: null,
                role: "viewer" as const,
            },
        ],
    });
}

describe("WorkflowDetailPage access mutations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWorkflow).mockResolvedValue(workflow);
        vi.mocked(getWorkflowPeople).mockImplementation(people);
        vi.mocked(listWorkflowShares).mockResolvedValue([]);
        vi.mocked(shareWorkflow).mockResolvedValue(undefined);
        vi.mocked(deleteWorkflowShare).mockResolvedValue(undefined);
        vi.stubGlobal(
            "matchMedia",
            vi.fn().mockReturnValue({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }),
        );
    });

    it.each([1, 2])("matches toolbar and right-click actions for %i selected columns", async (count) => {
        const user = userEvent.setup();
        const tabular = { ...workflow, metadata: { ...workflow.metadata, type: "tabular" as const },
            columns_config: [0, 1].map((index) => ({ index, name: `Column ${index + 1}`, prompt: "Extract text", format: "text" as const })),
        };
        vi.mocked(getWorkflow).mockResolvedValue(tabular);
        vi.mocked(updateWorkflow).mockResolvedValue(tabular);
        render(<WorkflowDetailPage id="workflow-1" workflowType="tabular" />);
        await user.click(await screen.findByRole("checkbox", { name: "Select Column 1" }));
        if (count === 2) await user.click(screen.getByRole("checkbox", { name: "Select Column 2" }));
        await user.click(screen.getByRole("button", { name: "Actions" }));
        const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
        expect(items).toEqual(count === 1 ? ["View", "Delete"] : ["Delete 2 columns"]);
        await user.keyboard("{Escape}");
        fireEvent.contextMenu(screen.getByText("Column 1"), { clientX: 40, clientY: 40 });
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(items);
        if (count === 2) {
            await user.click(screen.getByRole("menuitem", { name: "Delete 2 columns" }));
            expect(updateWorkflow).toHaveBeenCalledWith("workflow-1", { columns_config: [] });
        }
    });

    async function openAccess(user: ReturnType<typeof userEvent.setup>) {
        render(<WorkflowDetailPage id="workflow-1" workflowType="assistant" />);
        await user.click(
            await screen.findByRole("button", {
                name: "Open workflow access",
            }),
        );
        return screen.findByRole("button", {
            name: "Role for counsel@firm.test",
        });
    }

    it("does not report a role change as failed when only the re-read fails", async () => {
        const user = userEvent.setup();
        vi.mocked(listWorkflowShares).mockRejectedValue(
            new MikeApiError({ message: "Shares unavailable.", status: 500 }),
        );

        const rolePill = await openAccess(user);
        await user.click(rolePill);
        await user.click(screen.getByRole("menuitem", { name: "Owner" }));

        await waitFor(() =>
            expect(shareWorkflow).toHaveBeenCalledWith("workflow-1", {
                emails: ["counsel@firm.test"],
                role: "owner",
            }),
        );
        expect(
            screen.queryByText("Could not change that role."),
        ).not.toBeInTheDocument();
    });

    it("says the list is stale when the re-read fails", async () => {
        // `.catch(() => {})` left the roster showing the roles as they were
        // BEFORE a change the server accepted, with nothing saying the screen
        // had stopped tracking the server.
        const user = userEvent.setup();
        vi.mocked(listWorkflowShares).mockRejectedValue(
            new MikeApiError({ message: "Shares unavailable.", status: 500 }),
        );

        const rolePill = await openAccess(user);
        await user.click(rolePill);
        await user.click(screen.getByRole("menuitem", { name: "Owner" }));

        expect(
            await screen.findByText(
                "The change was saved, but this list could not be reloaded. Reopen Access to see the current one.",
            ),
        ).toBeVisible();
        // Still not reported as a failed change.
        expect(
            screen.queryByText("Could not change that role."),
        ).not.toBeInTheDocument();
    });

    it("does not report a revoke as failed when only the re-read fails", async () => {
        const user = userEvent.setup();
        vi.mocked(listWorkflowShares).mockRejectedValue(
            new MikeApiError({ message: "Shares unavailable.", status: 500 }),
        );

        await openAccess(user);
        await user.click(
            screen.getByRole("button", {
                name: "Actions for counsel@firm.test",
            }),
        );
        await user.click(screen.getByRole("menuitem", { name: "Remove" }));

        await waitFor(() =>
            expect(listWorkflowShares).toHaveBeenCalledWith("workflow-1"),
        );
        expect(
            screen.queryByText("Could not remove access."),
        ).not.toBeInTheDocument();
    });

    it("still reports a role change the grant itself refused", async () => {
        const user = userEvent.setup();
        vi.mocked(shareWorkflow).mockRejectedValue(
            new MikeApiError({
                message: "Only owners can share this workflow.",
                status: 403,
            }),
        );

        const rolePill = await openAccess(user);
        await user.click(rolePill);
        await user.click(screen.getByRole("menuitem", { name: "Owner" }));

        expect(
            await screen.findByText("Only owners can share this workflow."),
        ).toBeVisible();
    });
});

describe("the workspace a workflow opens", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWorkflowPeople).mockImplementation(people);
        vi.mocked(listWorkflowShares).mockResolvedValue([]);
        vi.stubGlobal(
            "matchMedia",
            vi.fn().mockReturnValue({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }),
        );
    });

    it.each([
        ["an organization's workflow", { org_id: "org-1" }, "org-1"],
        ["a personal workflow", { org_id: null }, null],
        // Built in: it belongs to no workspace, so it moves nobody.
        ["a built-in workflow", { org_id: null, is_system: true }, undefined],
    ])("is its own for %s", async (_name, over, expected) => {
        vi.mocked(getWorkflow).mockResolvedValue({ ...workflow, ...over });
        render(<WorkflowDetailPage id="workflow-1" workflowType="assistant" />);

        await waitFor(() =>
            expect(useItemWorkspace).toHaveBeenLastCalledWith(
                "workflow-1",
                expected,
            ),
        );
    });
});

const catalogProvenance = {
    catalog_repository: "Open-Legal-Products/mike-workflows",
    catalog_path: "assistant-workflows/opposing-counsel-review",
    license_file: "assistant-workflows/opposing-counsel-review/LICENSE",
    source_repository: "hythevc/awesome-legal-skills",
    source_path: "skills/opposing-counsel-review",
    source_commit: "f9f28cd",
    source_name: "Opposing Counsel Review",
    source_version: "2026-04-26",
    review_by: null,
    catalog_commit: "ce62e6a2",
    contributors: [],
    content_sha256: "abc",
};

function catalogCopy(overrides?: Partial<Workflow>): Workflow {
    return {
        id: "workflow-copy",
        is_owner: true,
        access_role: "owner",
        org_id: null,
        metadata: {
            title: "Opposing Counsel Review",
            type: "assistant",
            language: "English",
            practice: "Dispute Resolution",
            jurisdictions: ["United States"],
        },
        skill_md: "body",
        catalog_workflow_key: "opposing-counsel-review",
        catalog_version: "1.1.0",
        license: "Apache-2.0",
        license_evidence: "file",
        attribution:
            "Based on Opposing Counsel Review by Larissa Meredith-Flister.",
        provenance: catalogProvenance,
        catalog_status: "update_available",
        catalog_latest_version: "1.2.0",
        catalog_modified: true,
        modification_notice: "Modified by your organisation",
        ...overrides,
    } as unknown as Workflow;
}

describe("WorkflowDetailPage attribution", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWorkflowPeople).mockImplementation(people);
        vi.mocked(listWorkflowShares).mockResolvedValue([]);
        vi.stubGlobal(
            "matchMedia",
            vi.fn().mockReturnValue({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }),
        );
    });

    it("shows the read-only credit, the modification notice and an update-available status on an imported copy", async () => {
        vi.mocked(getWorkflow).mockResolvedValue(catalogCopy());
        render(<WorkflowDetailPage id="workflow-copy" workflowType="assistant" />);

        expect(await screen.findByText("Credits and licence")).toBeVisible();
        expect(
            screen.getByRole("link", { name: /Apache-2\.0 licence text/ }),
        ).toHaveAttribute("href", "https://spdx.org/licenses/Apache-2.0.html");
        expect(
            screen.getByText(
                /Based on Opposing Counsel Review by Larissa Meredith-Flister\./,
            ),
        ).toBeVisible();
        // Status and modification notice are plain text, not pill badges.
        expect(screen.getByText("Update available")).toBeVisible();
        expect(screen.getByText("Modified by your organisation")).toBeVisible();
        // Source links to the catalog tree at the commit the copy was made from.
        expect(
            screen.getByRole("link", { name: "View source at this revision" }),
        ).toHaveAttribute(
            "href",
            "https://github.com/Open-Legal-Products/mike-workflows/tree/ce62e6a2/assistant-workflows/opposing-counsel-review",
        );
    });

    it("shows a withdrawn copy's status as plain text", async () => {
        vi.mocked(getWorkflow).mockResolvedValue(
            catalogCopy({
                catalog_status: "withdrawn",
                catalog_latest_version: null,
                catalog_modified: false,
                modification_notice: null,
            }),
        );
        render(<WorkflowDetailPage id="workflow-copy" workflowType="assistant" />);

        expect(await screen.findByText("Withdrawn from the catalog")).toBeVisible();
        expect(
            screen.queryByText("Modified by your organisation"),
        ).not.toBeInTheDocument();
    });

    it("duplicates a built-in to an editable copy through W04's route", async () => {
        const user = userEvent.setup();
        vi.mocked(getWorkflow).mockResolvedValue(
            catalogCopy({
                id: "builtin-opposing-counsel-review",
                is_owner: false,
                access_role: "viewer",
                allow_edit: false,
                is_system: true,
                catalog_status: null,
                catalog_modified: false,
                modification_notice: null,
            }),
        );
        const editableCopy = catalogCopy({ id: "workflow-new-copy" });
        vi.mocked(duplicateBuiltInWorkflow).mockResolvedValue(editableCopy);

        render(
            <WorkflowDetailPage
                id="builtin-opposing-counsel-review"
                workflowType="assistant"
            />,
        );

        await screen.findByText("Credits and licence");
        await user.click(screen.getByRole("button", { name: "Workflow actions" }));
        await user.click(
            screen.getByRole("menuitem", { name: "Duplicate to customise" }),
        );

        await waitFor(() =>
            expect(duplicateBuiltInWorkflow).toHaveBeenCalledWith(
                "builtin-opposing-counsel-review",
            ),
        );
        await waitFor(() =>
            expect(routerPush).toHaveBeenCalledWith(
                "/workflows/assistant/workflow-new-copy",
            ),
        );
    });

    it("links back to the list when a workflow is not found", async () => {
        const user = userEvent.setup();
        vi.mocked(getWorkflow).mockRejectedValue(
            new MikeApiError({ message: "Not found", status: 404 }),
        );
        render(<WorkflowDetailPage id="missing" workflowType="assistant" />);

        expect(await screen.findByText("Workflow not found")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Back to workflows" }));
        expect(routerPush).toHaveBeenCalledWith("/workflows");
    });
});
