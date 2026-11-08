// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    addIntakeRequestComment,
    assignIntakeRequest,
    changeIntakeRequestStatus,
    createIntakeMatter,
    listIntakeRequestComments,
    type RequestDeskChange,
    type RequestDeskComment,
    type RequestDeskRequest,
} from "@/app/lib/mikeApi";
import { clearToasts, getSnapshot } from "@/shared/lib/toastStore";
import { IntakeRequestPanel } from "./IntakeRequestPanel";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listIntakeRequestComments: vi.fn(),
    assignIntakeRequest: vi.fn(),
    changeIntakeRequestStatus: vi.fn(),
    addIntakeRequestComment: vi.fn(),
    createIntakeMatter: vi.fn(),
}));

const ME = "alex@example.com";

function makeRequest(overrides: Partial<RequestDeskRequest> = {}): RequestDeskRequest {
    return {
        id: "req-1",
        org_id: "org-1",
        reference: "REQ-1",
        reference_number: 1,
        title: "Acme distribution agreement",
        details: "Please review the draft.",
        request_type: "Contract review",
        status: "new",
        priority: "normal",
        source: "internal",
        requester_name: "Dana Client",
        requester_email: "dana@example.com",
        assignee: null,
        created_by: {
            user_id: "u1",
            email: ME,
            display_name: "Alex Lawyer",
            is_member: true,
        },
        matter: null,
        sla_due_at: null,
        is_overdue: false,
        closed_at: null,
        created_at: "2026-11-01T10:00:00.000Z",
        updated_at: "2026-11-01T10:00:00.000Z",
        access_role: "owner",
        ...overrides,
    };
}

function makeComment(overrides: Partial<RequestDeskComment> = {}): RequestDeskComment {
    return {
        id: "c-1",
        request_id: "req-1",
        kind: "comment",
        body: "",
        from_status: null,
        to_status: null,
        event: null,
        subject: null,
        author: {
            user_id: "u1",
            email: ME,
            display_name: "Alex Lawyer",
            is_member: true,
        },
        created_at: "2026-11-01T11:00:00.000Z",
        ...overrides,
    };
}

function change(request: RequestDeskRequest): RequestDeskChange {
    return { changed: true, request, comment: makeComment({ kind: "system" }) };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearToasts();
    vi.mocked(listIntakeRequestComments).mockResolvedValue([]);
});

afterEach(() => clearToasts());

async function renderPanel(
    request = makeRequest(),
    onRequestChanged = vi.fn(),
) {
    render(
        <IntakeRequestPanel
            request={request}
            currentUserEmail={ME}
            onClose={vi.fn()}
            onRequestChanged={onRequestChanged}
        />,
    );
    // Wait for the activity trail to settle so later queries are stable.
    await waitFor(() =>
        expect(listIntakeRequestComments).toHaveBeenCalledWith(
            "req-1",
            expect.anything(),
        ),
    );
    return { onRequestChanged };
}

describe("IntakeRequestPanel", () => {
    it("assigns the request to the signed-in lawyer through the API", async () => {
        const user = userEvent.setup();
        const assigned = makeRequest({
            assignee: {
                user_id: "u1",
                email: ME,
                display_name: "Alex Lawyer",
                is_member: true,
            },
        });
        vi.mocked(assignIntakeRequest).mockResolvedValue(change(assigned));
        const { onRequestChanged } = await renderPanel();

        await user.click(screen.getByRole("button", { name: "Assign to me" }));

        expect(assignIntakeRequest).toHaveBeenCalledWith("req-1", ME);
        await waitFor(() =>
            expect(onRequestChanged).toHaveBeenCalledWith(assigned),
        );
    });

    it("changes the status through the API with the expected current status", async () => {
        const moved = makeRequest({ status: "in_progress" });
        vi.mocked(changeIntakeRequestStatus).mockResolvedValue(change(moved));
        await renderPanel();

        fireEvent.change(
            screen.getByRole("combobox", { name: "Change status" }),
            { target: { value: "in_progress" } },
        );

        await waitFor(() =>
            expect(changeIntakeRequestStatus).toHaveBeenCalledWith(
                "req-1",
                "in_progress",
                { expectedStatus: "new" },
            ),
        );
    });

    it("adds a comment through the API and clears the box on success", async () => {
        const user = userEvent.setup();
        vi.mocked(addIntakeRequestComment).mockResolvedValue(
            makeComment({ body: "Looks good" }),
        );
        await renderPanel();

        const box = screen.getByRole("textbox", { name: "Add a comment" });
        await user.type(box, "Looks good");
        await user.click(screen.getByRole("button", { name: "Add comment" }));

        expect(addIntakeRequestComment).toHaveBeenCalledWith("req-1", "Looks good");
        await waitFor(() => expect(box).toHaveValue(""));
    });

    it("shows a failure through notifyError and keeps the typed comment", async () => {
        const user = userEvent.setup();
        vi.mocked(addIntakeRequestComment).mockRejectedValue(
            new Error("network down"),
        );
        await renderPanel();

        const box = screen.getByRole("textbox", { name: "Add a comment" });
        await user.type(box, "Keep me");
        await user.click(screen.getByRole("button", { name: "Add comment" }));

        // A warning notice is raised...
        await waitFor(() => expect(getSnapshot().length).toBeGreaterThan(0));
        // ...and the draft the lawyer typed is still there to retry.
        expect(box).toHaveValue("Keep me");
    });

    it("creates a matter from the request through the API", async () => {
        const user = userEvent.setup();
        const withMatter = makeRequest({
            matter: { id: "proj-1", name: "Acme matter", can_open: true },
        });
        vi.mocked(createIntakeMatter).mockResolvedValue({
            ...change(withMatter),
            project: { id: "proj-1" },
        });
        const { onRequestChanged } = await renderPanel();

        await user.click(screen.getByRole("button", { name: "Create matter" }));

        expect(createIntakeMatter).toHaveBeenCalledWith("req-1");
        await waitFor(() =>
            expect(onRequestChanged).toHaveBeenCalledWith(withMatter),
        );
    });

    it("lets a viewer take an unassigned open request but not change its status", async () => {
        const request = makeRequest({ access_role: "viewer" });
        vi.mocked(assignIntakeRequest).mockResolvedValue(change(request));
        await renderPanel(request);

        expect(
            screen.getByRole("button", { name: "Take this request" }),
        ).toBeVisible();
        expect(
            screen.queryByRole("combobox", { name: "Change status" }),
        ).not.toBeInTheDocument();
    });
});
