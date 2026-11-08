// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    completedFirstRunSteps,
    FirstRunChecklist,
    markFirstRunStep,
} from "./FirstRunChecklist";

const state = vi.hoisted(() => ({
    workspace: undefined as string | undefined,
    pending: false,
    onOpened: undefined as ((project: unknown) => void) | undefined,
    openSampleMatter: vi.fn(),
}));

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspaceParam: () => state.workspace,
}));

vi.mock("@/app/hooks/useSampleMatter", () => ({
    useSampleMatter: (onOpened: (project: unknown) => void) => {
        state.onOpened = onOpened;
        return { pending: state.pending, openSampleMatter: state.openSampleMatter };
    },
}));

beforeEach(() => {
    window.localStorage.clear();
    state.workspace = undefined;
    state.pending = false;
    state.onOpened = undefined;
    state.openSampleMatter = vi.fn(() => state.onOpened?.({ id: "sample-1" }));
});
afterEach(() => vi.clearAllMocks());

describe("FirstRunChecklist", () => {
    it("lists the personal-workspace steps and opens the sample matter", async () => {
        render(<FirstRunChecklist />);

        expect(screen.getByText("Open the sample matter")).toBeVisible();
        expect(screen.getByText("Ask a question and see a quote marked found")).toBeVisible();
        expect(screen.getByText("Run a workflow on a document")).toBeVisible();
        expect(screen.getByText("Review a tracked change")).toBeVisible();
        // The invite step is organization-only.
        expect(screen.queryByText("Invite a colleague")).not.toBeInTheDocument();
        expect(screen.getByText("0 of 4 done")).toBeVisible();

        await userEvent.click(
            screen.getByRole("button", { name: "Try a sample matter" }),
        );
        expect(state.openSampleMatter).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByText("1 of 4 done")).toBeVisible());
        expect(completedFirstRunSteps().has("sample-matter")).toBe(true);
    });

    it("shows the invite step inside an organization", () => {
        state.workspace = "org-1";
        render(<FirstRunChecklist />);
        expect(screen.getByText("Invite a colleague")).toBeVisible();
        expect(
            screen.getByText(/They'll see the invitation when they open the app/),
        ).toBeVisible();
        expect(screen.getByText("0 of 5 done")).toBeVisible();
    });

    it("disables the action while a request is in flight", () => {
        state.pending = true;
        render(<FirstRunChecklist />);
        const button = screen.getByRole("button", {
            name: "Opening sample matter…",
        });
        expect(button).toBeDisabled();
    });

    it("reflects steps already completed in storage", () => {
        markFirstRunStep("ask-question");
        render(<FirstRunChecklist />);
        expect(screen.getByText("1 of 4 done")).toBeVisible();
    });

    it("dismisses the guide", async () => {
        render(<FirstRunChecklist />);
        await userEvent.click(
            screen.getByRole("button", { name: "Dismiss the get-started guide" }),
        );
        expect(
            screen.queryByRole("region", { name: "Get started" }),
        ).not.toBeInTheDocument();
    });

    it("hides once every step is done", () => {
        for (const step of [
            "sample-matter",
            "ask-question",
            "run-workflow",
            "review-change",
        ] as const) {
            markFirstRunStep(step);
        }
        render(<FirstRunChecklist />);
        expect(
            screen.queryByRole("region", { name: "Get started" }),
        ).not.toBeInTheDocument();
    });
});
