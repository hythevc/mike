// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import {
    CHAT_DELETE_FLUSH_MS,
    CHAT_DELETE_UNDO_MS,
} from "@/app/lib/chatDeleteUndo";
import type { Chat } from "@/app/components/shared/types";

const { deleteChat, listChats, session } = vi.hoisted(() => ({
    deleteChat: vi.fn(),
    listChats: vi.fn(),
    session: {
        user: { id: "u1", email: "a@firm.test" } as {
            id: string;
            email: string;
        } | null,
    },
}));

vi.mock("@/app/lib/mikeApi", () => ({
    createChat: vi.fn(),
    listChats: (...args: unknown[]) => listChats(...args),
    renameChat: vi.fn(),
    deleteChat: (...args: unknown[]) => deleteChat(...args),
    leaveChat: vi.fn(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: session.user }),
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspaceParam: () => undefined,
    useWorkspaceOrgId: () => null,
}));

import {
    ChatHistoryProvider,
    useChatHistoryContext,
    type ChatDeleteFlush,
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
const merger: Chat = {
    ...filing,
    id: "chat-c",
    title: "Merger checklist",
    created_at: "2026-09-30T00:00:00.000Z",
    updated_at: "2026-09-30T00:00:00.000Z",
};
const notice: Chat = {
    ...filing,
    id: "chat-d",
    title: "Notice letter",
    created_at: "2026-09-29T00:00:00.000Z",
    updated_at: "2026-09-29T00:00:00.000Z",
};

/** A DELETE that has not been answered yet. */
function unansweredDelete() {
    let answer!: { resolve: () => void; reject: (error: unknown) => void };
    deleteChat.mockReturnValue(
        new Promise<void>((resolve, reject) => {
            answer = { resolve, reject };
        }),
    );
    return () => answer;
}

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

const history = () => (
    <>
        <ChatHistoryProvider>
            <Probe />
        </ChatHistoryProvider>
        <ToastViewportUI />
    </>
);

function renderHistory() {
    return render(history());
}

async function deleteFiling() {
    const view = renderHistory();
    await waitFor(() =>
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        ),
    );
    act(() => latest.deleteChatWithUndo(filing));
    return view;
}

/**
 * What AuthContext does on every window focus and every return to the tab:
 * it re-reads the session and hands out a new user object for the same
 * account, which re-reads the chat list.
 */
async function refreshSession(view: ReturnType<typeof render>) {
    const reads = listChats.mock.calls.length;
    session.user = { id: "u1", email: "a@firm.test" };
    view.rerender(history());
    await waitFor(() => expect(listChats.mock.calls.length).toBe(reads + 1));
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    clearToasts();
    session.user = { id: "u1", email: "a@firm.test" };
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

    it("puts the chat back on Undo after a session check re-reads the list", async () => {
        const view = await deleteFiling();
        await refreshSession(view);
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );

        fireEvent.click(screen.getByRole("button", { name: "Undo" }));

        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 2);
        });
        expect(deleteChat).not.toHaveBeenCalled();
    });

    it("puts the chat back when a delete sent after a session check is refused", async () => {
        deleteChat.mockRejectedValue(
            Object.assign(new Error("Forbidden"), { status: 403 }),
        );
        const view = await deleteFiling();
        await refreshSession(view);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });

        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Couldn't delete the chat",
        );
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
    });

    it("keeps the chat out of a list read while its delete is still being sent", async () => {
        let finishDelete!: () => void;
        deleteChat.mockReturnValue(
            new Promise<void>((resolve) => {
                finishDelete = resolve;
            }),
        );
        await deleteFiling();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });
        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");

        // A session check re-reads the list before the server has answered.
        await act(async () => {
            await latest.loadChats();
        });
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );

        // Signing out now waits for that delete instead of sending another.
        let flushed = false;
        void latest.flushPendingChatDeletes().then(() => {
            flushed = true;
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(flushed).toBe(false);
        await act(async () => finishDelete());
        expect(flushed).toBe(true);
        expect(deleteChat).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("titles")).toHaveTextContent("Lease review");
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );
    });

    it("puts back a chat deleted before the list loaded once the list would show it", async () => {
        let resolveList!: (rows: Chat[]) => void;
        listChats.mockReturnValueOnce(
            new Promise<Chat[]>((resolve) => {
                resolveList = resolve;
            }),
        );
        renderHistory();
        await waitFor(() => expect(listChats).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId("titles")).toHaveTextContent("loading");

        // Deleted from the chat's own page while the history still loads.
        act(() => latest.deleteChatWithUndo(filing));
        await act(async () => resolveList([filing, lease]));
        expect(screen.getByTestId("titles")).toHaveTextContent("Lease review");
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );

        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
    });

    it("keeps the window open while the notice is hovered or focused", async () => {
        await deleteFiling();
        const notice = screen.getByRole("status");

        fireEvent.mouseEnter(notice);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 3);
        });
        expect(deleteChat).not.toHaveBeenCalled();

        // Keyboard focus on Undo holds it too, after the pointer leaves.
        const undo = screen.getByRole("button", { name: "Undo" });
        fireEvent.focus(undo);
        fireEvent.mouseLeave(notice);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 3);
        });
        expect(deleteChat).not.toHaveBeenCalled();

        fireEvent.blur(undo, { relatedTarget: document.body });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });
        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
    });

    it("sends the delete at once when the notice is closed", async () => {
        await deleteFiling();

        fireEvent.click(
            screen.getByRole("button", { name: "Dismiss notification" }),
        );

        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );
    });

    it("drops a waiting delete, unsent, when the session ends", async () => {
        const view = await deleteFiling();

        // AuthContext discards every notice when the session ends or
        // another account signs in.
        act(() => clearToasts());
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 2);
        });
        view.unmount();

        expect(deleteChat).not.toHaveBeenCalled();
    });

    it("sends every waiting delete at once when asked to before signing out", async () => {
        await deleteFiling();
        act(() => latest.deleteChatWithUndo(lease));

        await act(async () => {
            await latest.flushPendingChatDeletes();
        });

        expect(deleteChat).toHaveBeenCalledTimes(2);
        expect(deleteChat).toHaveBeenCalledWith("chat-a");
        expect(deleteChat).toHaveBeenCalledWith("chat-b");
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
        // Nothing is left to send when the session then ends.
        act(() => clearToasts());
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS * 2);
        });
        expect(deleteChat).toHaveBeenCalledTimes(2);
    });

    // Deleted in another tab, or with every chat from Settings, while this
    // one waited on Undo: the server no longer has it.
    it("treats a chat that is already gone as deleted", async () => {
        const { MikeApiError } = await vi.importActual<
            typeof import("@/app/lib/mikeApi")
        >("@/app/lib/mikeApi");
        deleteChat.mockRejectedValue(
            new MikeApiError({ message: "Chat not found", status: 404 }),
        );
        await deleteFiling();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });

        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByTestId("titles")).toHaveTextContent("Lease review");
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );
        // Nothing is left waiting to be sent.
        let flushed: ChatDeleteFlush | null = null;
        await act(async () => {
            flushed = await latest.flushPendingChatDeletes();
        });
        expect(flushed).toEqual({ refused: 0 });
        expect(deleteChat).toHaveBeenCalledTimes(1);
    });

    it("keeps each Undo open for its whole window when several chats are deleted in a row", async () => {
        listChats.mockResolvedValue([filing, lease, merger, notice]);
        renderHistory();
        await waitFor(() => expect(latest.chats?.length).toBe(4));

        for (const chat of [filing, lease, merger, notice]) {
            act(() => latest.deleteChatWithUndo(chat));
        }

        expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(4);
        expect(deleteChat).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS - 100);
        });
        expect(deleteChat).not.toHaveBeenCalled();

        // The oldest notice still undoes its own delete.
        fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]);
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing",
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(deleteChat).toHaveBeenCalledTimes(3);
        expect(deleteChat).not.toHaveBeenCalledWith("chat-a");
    });

    it("waits for the deletes it sends for at most the flush limit", async () => {
        const answer = unansweredDelete();
        await deleteFiling();

        let flushed: ChatDeleteFlush | null = null;
        void latest.flushPendingChatDeletes().then((result) => {
            flushed = result;
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_FLUSH_MS - 100);
        });
        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");
        expect(flushed).toBeNull();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(flushed).toEqual({ refused: 0 });
        // The unanswered delete still keeps the chat out of the list.
        expect(screen.getByTestId("titles")).not.toHaveTextContent(
            "Quarterly filing",
        );
        await act(async () => answer().resolve());
        expect(deleteChat).toHaveBeenCalledTimes(1);
    });

    it("counts refused deletes, and leaves telling the person to a caller that asks", async () => {
        deleteChat.mockRejectedValue(
            Object.assign(new Error("Forbidden"), { status: 403 }),
        );
        await deleteFiling();

        let flushed: ChatDeleteFlush | null = null;
        await act(async () => {
            flushed = await latest.flushPendingChatDeletes({ report: false });
        });

        expect(flushed).toEqual({ refused: 1 });
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByTestId("titles")).toHaveTextContent(
            "Quarterly filing,Lease review",
        );
    });

    it("does not show a refusal that arrives after the person signed out", async () => {
        const answer = unansweredDelete();
        const view = await deleteFiling();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CHAT_DELETE_UNDO_MS);
        });
        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-a");

        session.user = null;
        view.rerender(history());
        await act(async () => {
            answer().reject(
                Object.assign(new Error("Bad gateway"), { status: 502 }),
            );
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(screen.queryByRole("alert")).toBeNull();
    });
});
