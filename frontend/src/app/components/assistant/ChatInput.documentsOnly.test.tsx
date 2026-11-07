// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ChatInput } from "./ChatInput";

// A fixed selected model so submitMessage's "choose a model first" guard is
// satisfied; isModelAvailable is mocked true below.
vi.mock("@/app/hooks/useSelectedModel", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/hooks/useSelectedModel")>()),
    useSelectedModel: () => ["test-model", vi.fn()],
}));

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(async () => []),
    uploadStandaloneDocument: vi.fn(),
    uploadProjectDocuments: vi.fn(),
    uploadStandaloneDocuments: vi.fn(),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: vi.fn(),
}));
vi.mock("@/app/hooks/useConfiguredModels", () => ({
    useConfiguredModels: () => [],
}));
vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));
vi.mock("./ModelToggle", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./ModelToggle")>()),
    ModelToggle: () => null,
}));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({
    AddDocumentsModal: vi.fn(() => null),
}));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: vi.fn(() => null),
}));
vi.mock("../playbooks/PlaybookPickerModal", () => ({
    PlaybookPickerModal: vi.fn(() => null),
}));
vi.mock("../popups/ApiKeyMissingPopup", () => ({
    ApiKeyMissingPopup: () => null,
}));

class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
}

function mockProfile() {
    vi.mocked(useUserProfile).mockReturnValue({
        profile: {
            openRouterModels: [],
            vercelModels: [],
            openCodeGoModels: [],
            apiKeys: {},
        },
        loading: false,
        apiKeysDegraded: false,
    } as unknown as ReturnType<typeof useUserProfile>);
}

describe("ChatInput documents-only toggle (W25)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        mockProfile();
    });

    it("shows the toggle (aria-pressed) and sends answer_scope when on", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(
            <ChatInput
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
                projectId="p1"
            />,
        );
        const toggle = screen.getByRole("button", { name: "Documents only" });
        expect(toggle).toHaveAttribute("aria-pressed", "false");

        await user.click(toggle);
        expect(toggle).toHaveAttribute("aria-pressed", "true");

        const input = screen.getByRole("combobox");
        fireEvent.change(input, { target: { value: "What does clause 3 say?" } });
        const send = screen.getByRole("button", { name: "Send message" });
        await waitFor(() => expect(send).toBeEnabled());
        fireEvent.click(send);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toMatchObject({
            answerScope: "documents",
        });
    });

    it("omits answer_scope when the toggle is off", async () => {
        const onSubmit = vi.fn();
        render(
            <ChatInput
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
                projectId="p1"
            />,
        );
        const input = screen.getByRole("combobox");
        fireEvent.change(input, { target: { value: "A question." } });
        const send = screen.getByRole("button", { name: "Send message" });
        await waitFor(() => expect(send).toBeEnabled());
        fireEvent.click(send);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0].answerScope).toBeUndefined();
    });

    it("hides the toggle when no documents are in scope", () => {
        render(
            <ChatInput onSubmit={vi.fn()} onCancel={vi.fn()} isLoading={false} />,
        );
        expect(
            screen.queryByRole("button", { name: "Documents only" }),
        ).toBeNull();
    });
});
