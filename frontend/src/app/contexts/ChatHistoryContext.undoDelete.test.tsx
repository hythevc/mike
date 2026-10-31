// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import { CHAT_DELETE_UNDO_MS } from "@/app/lib/chatDeleteUndo";
import type { Chat } from "@/app/components/shared/types";

const { deleteChat, listChats } = vi.hoisted(() => ({
    deleteChat: vi.fn(),
    listChats: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", () => ({
    createChat: vi.fn(),
    listChats: (...args: unknown[]) => listChats(...args),
    renameChat: vi.fn(),
    deleteChat: (...args: unknown[]) => deleteChat(...args),
    leaveChat: vi.fn(),
}));

const STABLE_USER = { id: "u1", email: "a@firm.test" };
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: STABLE_USER }),
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspaceParam: () => undefined,
    useWorkspaceOrgId: () => null,
}));

import {
    ChatHistoryProvider,
    useChatHistoryContext,
} from "./ChatHistoryContext";

const filing: Chat = {
    id: "chat-a",
    project_id: null,
    user_id: "u1",
    title: "Quarterly filing",
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    is_owner: true,
    access_role: "owner",
};
const lease: Chat = {
    ...filing,
    id: "chat-b",
    title: "Lease review",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
};

let latest: ReturnType<typeof useChatHistoryContext>;
function Probe() {
    const context = useChatHistoryContext();
    useEffect(() => {
        latest = context;
    });
    return (
        <p data-testid="titles">
            {context.chats?.map((chat) => chat.title).join(",") ?? "loading"}
        </p>
    );
}

function renderHistory() {
    return render(
        <>
            <ChatHistoryProvider>
                <Probe />
            </ChatHistoryProvider>
            <ToastViewportUI />
        </>,
    );
}

async function deleteFiling() {
    renderHistory();
    await waitFor(() =>
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        ),
    );
    act(() => latest.deleteChatWithUndo(filing));
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    clearToasts();
    listChats.mockResolvedValue([filing, lease]);
    deleteChat.mockResolvedValue(undefined);
});

afterEach(() => {
    clearToasts();
    vi.useRealTimers();
});

describe("deleteChatWithUndo", () => {
    it("hides the chat at once and sends the delete only after the undo window", async () => {
        await deleteFiling();

        expect(screen.getByTestId("titles")).toHaveTextContent("Lease review");
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );
        const notice = screen.getByRole("status");
        expect(notice).toHaveTextContent("Chat deleted");
        expect(notice).toHaveTextContent("“Quarterly filing” was deleted.");

        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS - 100);
        });
        expect(deleteChat).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
        // Undo is gone once the delete has been sent.
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    it("puts the chat back on Undo and never sends the delete", async () => {
        await deleteFiling();

        fireEvent.click(screen.getByRole("button", { name: "Undo" }));

        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 3);
        });
        expect(deleteChat).not.toHaveBeenCalled();
    });

    it("puts the chat back and says why when the server refuses the delete", async () => {
        deleteChat.mockRejectedValue(
            Object.assign(new Error("Forbidden"), { status: 403 }),
        );
        await deleteFiling();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Couldn't delete the chat",
        );
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
        // Deleting again goes through the row's own confirmation.
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("sends a pending delete with keepalive when the page is closed", async () => {
        await deleteFiling();

        act(() => {
            window.dispatchEvent(new Event("pagehide"));
        });

        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a", {
            keepalive: true,
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 2);
        });
        expect(deleteChat).toHaveBeenCalledTimes(1);
    });

    it("sends a pending delete at once when the app shell goes away", async () => {
        const view = renderHistory();
        await waitFor(() => expect(latest.chats?.length).toBe(2));
        act(() => latest.deleteChatWithUndo(filing));

        view.unmount();

        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
    });

    it("keeps the chat out of a list read inside the undo window", async () => {
        await deleteFiling();

        // The server still lists it until the delete is sent.
        await act(async () => {
            await latest.loadChats();
        });

        expect(screen.getByTestId("titles")).toHaveTextContent("Lease review");
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );
        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
    });

    it("ignores a second delete of a chat already waiting", async () => {
        await deleteFiling();
        act(() => latest.deleteChatWithUndo(filing));

        expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });
        expect(deleteChat).toHaveBeenCalledTimes(1);
    });
});
