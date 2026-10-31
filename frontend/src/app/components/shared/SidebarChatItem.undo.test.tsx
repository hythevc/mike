// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import type { Chat } from "@/app/components/shared/types";

// The real sidebar row on the real chat history, with only the network
// mocked: what the user does in the row decides whether a DELETE is sent.

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
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const STABLE_USER = { id: "u1", email: "a@firm.test" };
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: STABLE_USER }),
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspaceParam: () => undefined,
    useWorkspaceOrgId: () => null,
}));
vi.mock("@/app/components/assistant/ChatAccessModal", () => ({
    ChatAccessModal: () => null,
}));

import {
    ChatHistoryProvider,
    useChatHistoryContext,
} from "@/app/contexts/ChatHistoryContext";
import { SidebarChatItem } from "./SidebarChatItem";

const filing: Chat = {
    id: "chat-1",
    project_id: null,
    user_id: "u1",
    title: "Quarterly filing",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    is_owner: true,
    access_role: "owner",
};

function SidebarHistory() {
    const { chats } = useChatHistoryContext();
    return (
        <div>
            {chats?.map((chat) => (
                <SidebarChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={false}
                    onSelect={vi.fn()}
                />
            ))}
        </div>
    );
}

async function confirmDeleteFromRow() {
    render(
        <>
            <ChatHistoryProvider>
                <SidebarHistory />
            </ChatHistoryProvider>
            <ToastViewportUI />
        </>,
    );
    const trigger = await screen.findByRole("button", {
        name: "Actions for Quarterly filing",
    });
    // Radix opens on pointerdown, not click.
    fireEvent.pointerDown(
        trigger,
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // Choosing Delete only asks.
    const dialog = await screen.findByRole("dialog", { name: "Delete chat?" });
    expect(
        screen.getByRole("button", { name: "Quarterly filing" }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
        screen.queryByRole("button", { name: "Quarterly filing" }),
    ).not.toBeInTheDocument();
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    clearToasts();
    listChats.mockResolvedValue([filing]);
    deleteChat.mockResolvedValue(undefined);
});

afterEach(() => {
    clearToasts();
    vi.useRealTimers();
});

describe("deleting a chat from the sidebar", () => {
    it("never sends the DELETE when Undo is pressed within 8 seconds", async () => {
        await confirmDeleteFromRow();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(7_000);
        });
        fireEvent.click(screen.getByRole("button", { name: "Undo" }));

        expect(
            await screen.findByRole("button", { name: "Quarterly filing" }),
        ).toBeInTheDocument();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(deleteChat).not.toHaveBeenCalled();
    });

    it("sends the DELETE once the 8 seconds pass without Undo", async () => {
        await confirmDeleteFromRow();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(7_900);
        });
        expect(deleteChat).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(deleteChat).toHaveBeenCalledExactlyOnceWith("chat-1");
    });
});
