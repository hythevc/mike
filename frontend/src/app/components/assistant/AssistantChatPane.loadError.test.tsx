// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MikeApiError } from "@/app/lib/mikeApi";
import { AssistantChatPane } from "./AssistantChatPane";

const mocks = vi.hoisted(() => ({
    loadAssistantChat: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    resetChat: vi.fn(),
    setNewChatMessages: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("@/app/lib/assistantTurns", () => ({
    loadAssistantChat: (...args: unknown[]) => mocks.loadAssistantChat(...args),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({
        setCurrentChatId: vi.fn(),
        newChatMessages: null,
        setNewChatMessages: mocks.setNewChatMessages,
        loadChats: vi.fn(),
    }),
}));
vi.mock("@/app/hooks/useAssistantChat", () => ({
    useAssistantChat: () => ({
        messages: [],
        isResponseLoading: false,
        handleChat: vi.fn(),
        setMessages: vi.fn(),
        cancel: vi.fn(),
        detach: vi.fn(),
        rejectedApiKey: null,
        dismissInvalidApiKey: vi.fn(),
        resetChat: mocks.resetChat,
    }),
}));
vi.mock("@/app/components/assistant/ChatView", () => ({
    AssistantChatColumn: ({ chatId }: { chatId: string | null }) => (
        <div data-testid="chat-column">{chatId ?? "new"}</div>
    ),
}));

const loadedChat = {
    chat: {
        id: "chat-1",
        title: "Quarterly filing",
        model: null,
        reasoning_level: null,
        is_owner: true,
        access_role: "owner",
    },
    messages: [{ id: "m1", role: "user", content: "hi" }],
};

function renderPane(openChat = vi.fn(), sideChat?: { onClose: () => void }) {
    render(
        <AssistantChatPane
            chatId="chat-1"
            openChat={openChat}
            adoptChat={vi.fn()}
            claimCreated={() => false}
            documentPanel={{} as never}
            sideChat={sideChat}
        />,
    );
    return openChat;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("AssistantChatPane when a chat cannot be loaded", () => {
    it.each([
        [
            "a server error",
            new MikeApiError({ message: "boom", status: 500 }),
            "Something went wrong on our side. Try again.",
            true,
        ],
        [
            "a network error",
            new TypeError("Failed to fetch"),
            "couldn't reach the server",
            true,
        ],
        [
            "a refusal",
            new MikeApiError({
                message: "You do not have access to this chat.",
                status: 403,
            }),
            "You do not have access to this chat.",
            false,
        ],
    ])("shows %s in place without opening a new chat", async (_label, error, message, retryable) => {
        mocks.loadAssistantChat.mockRejectedValue(error);
        const openChat = renderPane();

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Couldn't load this chat");
        expect(alert).toHaveTextContent(message);
        expect(
            screen.getByRole("button", { name: "Start a new chat" }),
        ).toBeVisible();
        expect(
            screen.queryByRole("button", { name: "Retry" }) !== null,
        ).toBe(retryable);
        expect(screen.queryByTestId("chat-column")).not.toBeInTheDocument();
        expect(openChat).not.toHaveBeenCalled();
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(mocks.push).not.toHaveBeenCalled();
    });

    it("loads the same chat again on Retry", async () => {
        mocks.loadAssistantChat
            .mockRejectedValueOnce(new MikeApiError({ message: "boom", status: 500 }))
            .mockResolvedValueOnce(loadedChat);
        const openChat = renderPane();

        fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

        expect(await screen.findByTestId("chat-column")).toHaveTextContent(
            "chat-1",
        );
        expect(mocks.loadAssistantChat).toHaveBeenCalledTimes(2);
        expect(mocks.loadAssistantChat).toHaveBeenNthCalledWith(2, "chat-1");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(openChat).not.toHaveBeenCalled();
    });

    it("says a chat holds no messages instead of replacing it", async () => {
        mocks.loadAssistantChat.mockResolvedValue({ ...loadedChat, messages: [] });
        const openChat = renderPane();

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "This chat has no messages",
        );
        expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
        expect(openChat).not.toHaveBeenCalled();
        expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("leaves for a new chat only when asked to", async () => {
        mocks.loadAssistantChat.mockRejectedValue(new TypeError("Failed to fetch"));
        const openChat = renderPane();

        fireEvent.click(
            await screen.findByRole("button", { name: "Start a new chat" }),
        );

        expect(mocks.resetChat).toHaveBeenCalled();
        expect(openChat).toHaveBeenCalledWith("");
    });

    it("keeps a failed side chat in its own pane", async () => {
        mocks.loadAssistantChat.mockRejectedValue(
            new MikeApiError({ message: "boom", status: 500 }),
        );
        const openChat = renderPane(vi.fn(), { onClose: vi.fn() });

        const alert = await screen.findByRole("alert");
        expect(alert.closest("[data-chat-pane]")).toHaveAttribute(
            "data-chat-pane",
            "side",
        );
        await waitFor(() => expect(openChat).not.toHaveBeenCalled());
    });
});
