"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import {
    useWorkspaceOrgId,
    useWorkspaceParam,
} from "@/app/contexts/WorkspaceContext";
import {
    createChat,
    deleteChat,
    leaveChat,
    listChats,
    renameChat,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import type { Chat, Message } from "@/app/components/shared/types";
import type { ProjectRole } from "@/app/lib/permissions";
import { subscribeAssistantTurns } from "@/app/lib/assistantTurns";
import { sortChatsByActivity, touchChatActivity } from "@/app/lib/chatActivity";
import { CHAT_DELETE_UNDO_MS } from "@/app/lib/chatDeleteUndo";
import { useLatestRef } from "@/app/hooks/useLatestRef";
import { dismissToast, showToast } from "@/shared/lib/toastStore";

interface ChatHistoryContextType {
    chats: Chat[] | null;
    hasMoreChats: boolean;
  loadingMoreChats: boolean;
    currentChatId: string | null;
    setCurrentChatId: (chatId: string | null) => void;
    /** The chat shown beside the current one, if a page shows two. */
    sideChatId: string | null;
    setSideChatId: (chatId: string | null) => void;
    /**
     * A chat the app shell asked the page on screen to show beside its
     * current one. The page opens it and clears the request.
     */
    sideChatRequest: string | null;
    requestSideChat: (chatId: string | null) => void;
    loadChats: () => Promise<void>;
  loadMoreChats: () => Promise<void>;
    saveChat: (
        projectId?: string,
        projectRole?: ProjectRole | null,
    ) => Promise<string | null>;
    renameChat: (chatId: string, title: string) => Promise<void>;
    updateChatTitle: (chatId: string, title: string) => void;
    newChatMessages: Message[] | null;
    setNewChatMessages: (messages: Message[] | null) => void;
    replaceChatId: (
        oldChatId: string,
        newChatId: string,
        title?: string,
    ) => void;
    /**
     * Delete a chat the person has confirmed deleting. It leaves the list at
     * once and a notice offers Undo; the server delete is sent only once
     * CHAT_DELETE_UNDO_MS pass without Undo. A delete the server refuses
     * puts the row back and says so.
     */
    deleteChatWithUndo: (chat: Chat) => void;
    leaveChat: (chatId: string) => Promise<void>;
}

/** A confirmed delete still inside its undo window. */
type PendingChatDelete = {
    chat: Chat;
    timer: ReturnType<typeof setTimeout>;
    toastId: string;
    /** Whether the row was listed, so only a listed row is put back. */
    listed: boolean;
    /** The list it was removed from; a newer list is not touched. */
    scopeVersion: number;
};

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(
    undefined,
);

const INITIAL_CHAT_LIMIT = 20;
const CHAT_PAGE_SIZE = 10;

type ChatCursor = { updatedAt: string; id: string };

function cursorFor(chat: Chat | undefined): ChatCursor | null {
    const updatedAt = chat?.updated_at || chat?.created_at;
    return chat && updatedAt ? { updatedAt, id: chat.id } : null;
}

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    // The sidebar history follows the active workspace: switching re-reads
    // the first page, through loadChats's identity changing below.
    const workspace = useWorkspaceParam();
    const workspaceOrgId = useWorkspaceOrgId();
    const identity = JSON.stringify([user?.id ?? null, workspace ?? "personal"]);
    const activeIdentity = useRef<string | null>(identity);
    useLayoutEffect(() => {
        activeIdentity.current = identity;
        return () => { activeIdentity.current = null; };
    }, [identity]);
    const [chats, setChats] = useState<Chat[] | null>(null);
    const [hasMoreChats, setHasMoreChats] = useState(false);
    const [loadingMoreChats, setLoadingMoreChats] = useState(false);
    const loadingMoreChatsRef = useRef(false);
    const nextChatCursorRef = useRef<ChatCursor | null>(null);
    // Which first-page read is current, and which workspace the list on
    // screen came from. A switch must not leave the previous workspace's
    // history showing, and its slower answer must not land on top of the new
    // one.
    const chatsRequestRef = useRef(0);
    const loadedScopeRef = useRef<string | undefined>(undefined);
    const scopeVersionRef = useRef(0);
    const scopeKey = JSON.stringify([user?.id, workspace]);
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [sideChatId, setSideChatId] = useState<string | null>(null);
    // "Retry" re-enters the latest loader: a callback cannot reference
    // itself, and these are re-created as the chat list changes.
    // Confirmed deletes still inside their undo window. The server still
    // lists these chats, so a list read in that window must leave them out.
    const pendingDeletesRef = useRef(new Map<string, PendingChatDelete>());
    const retryRef = useRef<{
        loadChats: () => void;
        loadMoreChats: () => void;
    }>({ loadChats: () => {}, loadMoreChats: () => {} });
    const [pendingSideChat, setPendingSideChat] = useState<{ identity: string; id: string | null } | null>(null);
    const sideChatRequest = pendingSideChat?.identity === identity ? pendingSideChat.id : null;
    const requestSideChat = useCallback((id: string | null) => {
        if (activeIdentity.current === identity) setPendingSideChat({ identity, id });
    }, [identity]);
    const [pendingMessages, setPendingMessages] = useState<{
        identity: string;
        messages: Message[] | null;
    } | null>(null);
    const newChatMessages = pendingMessages?.identity === identity
        ? pendingMessages.messages : null;
    const setNewChatMessages = useCallback((messages: Message[] | null) => {
        if (activeIdentity.current === identity) setPendingMessages({ identity, messages });
    }, [identity]);
    const invalidateScope = useCallback(() => {
        ++chatsRequestRef.current;
        ++scopeVersionRef.current;
    }, []);

    const loadChats = useCallback(async () => {
        // A detached turn may invoke the callback captured before navigation.
        if (loadedScopeRef.current !== scopeKey || activeIdentity.current !== identity) return;
        const request = ++chatsRequestRef.current;
        loadingMoreChatsRef.current = false;
        setLoadingMoreChats(false);
        if (!user) {
            setChats([]);
            setHasMoreChats(false);
            return;
        }

        try {
            const data = await listChats({
                limit: INITIAL_CHAT_LIMIT + 1,
                workspace,
            });
            if (request !== chatsRequestRef.current || activeIdentity.current !== identity) return;
            const page = data.slice(0, INITIAL_CHAT_LIMIT);
            setChats(
                sortChatsByActivity(
                    page.filter((chat) => !pendingDeletesRef.current.has(chat.id)),
                ),
            );
            nextChatCursorRef.current = cursorFor(page.at(-1));
            setHasMoreChats(data.length > INITIAL_CHAT_LIMIT);
        } catch (error) {
            if (request !== chatsRequestRef.current || activeIdentity.current !== identity) return;
            setChats([]);
            nextChatCursorRef.current = null;
            setHasMoreChats(false);
            // An empty sidebar is how "you have no chats" looks, so a failed
            // load has to say that it failed.
            notifyError(error, {
                action: "load your chats",
                dedupeKey: "chat-history",
                onRetry: () => retryRef.current.loadChats(),
            });
        }
    }, [user, workspace, scopeKey, identity]);

    useEffect(() => {
        if (loadedScopeRef.current !== scopeKey) {
            loadedScopeRef.current = scopeKey;
            ++scopeVersionRef.current;
            setChats(null);
            setHasMoreChats(false);
            nextChatCursorRef.current = null;
        }
        if (!user) setCurrentChatId(null);
        void loadChats();
        // Invalidate first pages, pagination and pending optimistic saves,
        // even when switching away and back before an old request finishes.
        return invalidateScope;
    }, [user, loadChats, scopeKey, invalidateScope]);

    const loadMoreChats = useCallback(async () => {
        if (
            loadedScopeRef.current !== scopeKey ||
            activeIdentity.current !== identity ||
            !user ||
            !hasMoreChats ||
            loadingMoreChatsRef.current ||
            chats === null
        ) {
            return;
        }

        loadingMoreChatsRef.current = true;
        setLoadingMoreChats(true);
        const request = chatsRequestRef.current;
        try {
            const cursor = nextChatCursorRef.current;
            if (!cursor) {
                setHasMoreChats(false);
                return;
            }
            const data = await listChats({
                limit: CHAT_PAGE_SIZE + 1,
                beforeUpdatedAt: cursor.updatedAt,
                beforeId: cursor.id,
                workspace,
            });
            // The workspace changed while this page was in flight: it
            // belongs to a list that is no longer on screen.
            if (request !== chatsRequestRef.current || activeIdentity.current !== identity) return;
            const page = data.slice(0, CHAT_PAGE_SIZE);
            nextChatCursorRef.current = cursorFor(page.at(-1));
            setChats((current) => {
                const existing = new Set(
                    (current ?? []).map((chat) => chat.id),
                );
                return sortChatsByActivity([
                    ...(current ?? []),
                    ...page.filter(
                        (chat) =>
                            !existing.has(chat.id) &&
                            !pendingDeletesRef.current.has(chat.id),
                    ),
                ]);
            });
            setHasMoreChats(data.length > CHAT_PAGE_SIZE);
        } catch (error) {
            // A page for a workspace no longer on screen failed: not news.
            if (request !== chatsRequestRef.current || activeIdentity.current !== identity) return;
            notifyError(error, {
                action: "load more chats",
                dedupeKey: "chat-history-more",
                onRetry: () => retryRef.current.loadMoreChats(),
            });
        } finally {
            if (request === chatsRequestRef.current && activeIdentity.current === identity) {
                loadingMoreChatsRef.current = false;
                setLoadingMoreChats(false);
            }
        }
    }, [chats, hasMoreChats, user, workspace, scopeKey, identity]);

    useEffect(
        () =>
            subscribeAssistantTurns((chatId) => {
                setChats((current) =>
                    current ? touchChatActivity(current, chatId) : current,
                );
            }),
        [],
    );

    useEffect(() => {
        retryRef.current = {
            loadChats: () => void loadChats(),
            loadMoreChats: () => void loadMoreChats(),
        };
    }, [loadChats, loadMoreChats]);

    const replaceChatId = useCallback(
        (oldChatId: string, newChatId: string, title?: string) => {
            if (!oldChatId || !newChatId || oldChatId === newChatId) {
                setCurrentChatId(newChatId || oldChatId || null);
                return;
            }

            setChats((prev) => {
                if (!prev) return prev;

                const nextChats = prev.map((chat) =>
                    chat.id === oldChatId
                        ? { ...chat, id: newChatId, title: title ?? chat.title }
                        : chat,
                );

                const seen = new Set<string>();
                return nextChats.filter((chat) => {
                    if (seen.has(chat.id)) return false;
                    seen.add(chat.id);
                    return true;
                });
            });
            setCurrentChatId(newChatId);
        },
        [],
    );

    const saveChat = useCallback(
        async (
            projectId?: string,
            projectRole?: ProjectRole | null,
        ): Promise<string | null> => {
            if (activeIdentity.current !== identity) return null;
            const scopeVersion = scopeVersionRef.current;
            try {
                // A chat started on its own belongs to the workspace it is
                // started in; inside a project, the project decides.
                const { id } = await createChat(
                    projectId
                        ? { project_id: projectId }
                        : workspaceOrgId
                          ? { org_id: workspaceOrgId }
                          : undefined,
                );
                if (scopeVersion !== scopeVersionRef.current || loadedScopeRef.current !== scopeKey || activeIdentity.current !== identity) return null;
                const now = new Date().toISOString();
                // The optimistic row must say what the server would say.
                // The overview RPC serves is_owner + access_role on every
                // row, and the sidebar's gates read them via roleFrom(),
                // which fails closed to viewer when both are absent — so
                // without a stamp the creator was refused rename and delete
                // on their own brand-new thread until a reload.
                //
                // What the stamp should SAY differs by chat kind. A
                // standalone chat belongs to its creator, so owner is what
                // the server serves back. A PROJECT chat does not: the
                // server derives its role from the caller's role on the
                // project (ensureSharedRowAccess), so an editor who starts a
                // thread there is an editor on it. Stamping owner offered
                // that editor a Delete which came back 403 — the sidebar
                // promised something the server refuses. Callers pass their
                // project role; absent one we fall back to editor, the
                // minimum the server requires to have created the chat at
                // all, rather than to the top of the ladder.
                const role: ProjectRole = projectId
                    ? (projectRole ?? "editor")
                    : "owner";
                const newChat: Chat = {
                    id,
                    project_id: projectId ?? null,
                    user_id: user?.id ?? "",
                    title: null,
                    created_at: now,
                    updated_at: now,
                    is_owner: role === "owner",
                    access_role: role,
                };
                setChats((prev) =>
                    sortChatsByActivity([newChat, ...(prev ?? [])]),
                );
                return id;
            } catch (error) {
                if (scopeVersion !== scopeVersionRef.current || loadedScopeRef.current !== scopeKey || activeIdentity.current !== identity) return null;
                // Callers only see `null`, and the ones that do simply stop —
                // so this is the last place that can tell the user their
                // chat was never created. No Retry: repeating the create
                // alone would strand an empty chat, and no caller re-runs
                // its whole submit (create + send) from here.
                notifyError(error, { action: "start a new chat" });
                return null;
            }
        },
        [user, workspaceOrgId, scopeKey, identity],
    );

    const renameChatFn = useCallback(
        async (chatId: string, title: string) => {
            const scopeVersion = scopeVersionRef.current;
            setChats((prev) =>
                touchChatActivity(
                    (prev ?? []).map((c) =>
                        c.id === chatId ? { ...c, title } : c,
                    ),
                    chatId,
                ),
            );
            try {
                await renameChat(chatId, title);
            } catch (error) {
                // Same contract as delete below: the optimistic write must
                // not become a silent success. The old bare catch let a
                // refused rename show the new title and then quietly revert
                // it on reload — the caller rethrows so the row's UI can say
                // why the title snapped back.
                if (scopeVersion === scopeVersionRef.current) void loadChats();
                throw error;
            }
        },
        [loadChats],
    );

    const updateChatTitle = useCallback((chatId: string, title: string) => {
        setChats((prev) =>
            touchChatActivity(
                (prev ?? []).map((chat) =>
                    chat.id === chatId ? { ...chat, title } : chat,
                ),
                chatId,
            ),
        );
    }, []);

    const chatsRef = useLatestRef(chats);

    // Put back exactly the row that left, in activity order, and only in the
    // list it left: a workspace switch since then has its own list.
    const restoreDeletedChat = useCallback((pending: PendingChatDelete) => {
        if (!pending.listed || pending.scopeVersion !== scopeVersionRef.current)
            return;
        setChats((current) =>
            current && !current.some((chat) => chat.id === pending.chat.id)
                ? sortChatsByActivity([...current, pending.chat])
                : current,
        );
    }, []);

    const takePendingDelete = useCallback((chatId: string) => {
        const pending = pendingDeletesRef.current.get(chatId);
        if (!pending) return null;
        pendingDeletesRef.current.delete(chatId);
        clearTimeout(pending.timer);
        dismissToast(pending.toastId);
        return pending;
    }, []);

    const commitChatDelete = useCallback(
        async (chatId: string) => {
            const pending = takePendingDelete(chatId);
            if (!pending) return;
            try {
                await deleteChat(chatId);
            } catch (error) {
                // The removal must not become a silent success: the row
                // comes back and the notice says why. No Retry: deleting
                // again is the row's own action, which asks first.
                restoreDeletedChat(pending);
                notifyError(error, {
                    action: "delete the chat",
                    dedupeKey: `chat-delete:${chatId}`,
                });
            }
        },
        [restoreDeletedChat, takePendingDelete],
    );

    const undoChatDelete = useCallback(
        (chatId: string) => {
            const pending = takePendingDelete(chatId);
            if (pending) restoreDeletedChat(pending);
        },
        [restoreDeletedChat, takePendingDelete],
    );

    const deleteChatWithUndo = useCallback(
        (chat: Chat) => {
            if (pendingDeletesRef.current.has(chat.id)) return;
            const listed =
                chatsRef.current?.some((entry) => entry.id === chat.id) ??
                false;
            setChats((current) =>
                current
                    ? current.filter((entry) => entry.id !== chat.id)
                    : current,
            );
            setCurrentChatId((current) => (current === chat.id ? null : current));
            const title = chat.title?.trim() || "Untitled chat";
            const toastId = showToast({
                tone: "info",
                title: "Chat deleted",
                message: `“${title}” was deleted.`,
                // Dismissed when the delete is sent, so Undo never outlives
                // the window in which it still works.
                durationMs: null,
                actions: [
                    { label: "Undo", onClick: () => undoChatDelete(chat.id) },
                ],
                dedupeKey: `chat-delete:${chat.id}`,
            });
            pendingDeletesRef.current.set(chat.id, {
                chat,
                listed,
                scopeVersion: scopeVersionRef.current,
                toastId,
                timer: setTimeout(
                    () => void commitChatDelete(chat.id),
                    CHAT_DELETE_UNDO_MS,
                ),
            });
        },
        [chatsRef, commitChatDelete, undoChatDelete],
    );

    // A confirmed delete must not be lost with its timer. Leaving the app
    // shell sends it at once; closing or reloading the tab sends it with
    // keepalive, since the page cannot wait for the answer.
    useEffect(() => {
        const pending = pendingDeletesRef.current;
        const sendOnPageHide = () => {
            for (const [chatId, entry] of pending) {
                clearTimeout(entry.timer);
                dismissToast(entry.toastId);
                void deleteChat(chatId, { keepalive: true }).catch(() => {
                    // The page is going away: there is no one left to tell,
                    // and the chat simply stays listed on the next visit.
                });
            }
            pending.clear();
        };
        window.addEventListener("pagehide", sendOnPageHide);
        return () => {
            window.removeEventListener("pagehide", sendOnPageHide);
            for (const chatId of [...pending.keys()]) {
                void commitChatDelete(chatId);
            }
        };
    }, [commitChatDelete]);

    const leaveChatFn = useCallback(async (chatId: string) => {
        const scopeVersion = scopeVersionRef.current;
        await leaveChat(chatId);
        if (scopeVersion !== scopeVersionRef.current || loadedScopeRef.current !== scopeKey || activeIdentity.current !== identity) return;
        // Invalidate reads started before the grant was removed.
        chatsRequestRef.current += 1;
        loadingMoreChatsRef.current = false;
        setLoadingMoreChats(false);
        setChats((prev) => prev?.filter((chat) => chat.id !== chatId) ?? null);
        setCurrentChatId((current) => current === chatId ? null : current);
        setSideChatId((current) => current === chatId ? null : current);
        // A directly opened chat can be left before History finishes loading.
        // Replace that invalidated read so the list does not stay a skeleton.
        if (chats === null) void loadChats();
    }, [scopeKey, identity, chats, loadChats]);

    const value = useMemo(
        () => ({
            chats,
            hasMoreChats,
      loadingMoreChats,
            currentChatId,
            setCurrentChatId,
            sideChatId,
            setSideChatId,
            sideChatRequest,
            requestSideChat,
            loadChats,
            loadMoreChats,
            saveChat,
            renameChat: renameChatFn,
            updateChatTitle,
            newChatMessages,
            setNewChatMessages,
            replaceChatId,
            deleteChatWithUndo,
            leaveChat: leaveChatFn,
        }),
        [
            chats,
            hasMoreChats,
      loadingMoreChats,
            currentChatId,
            sideChatId,
            sideChatRequest,
            requestSideChat,
            loadChats,
            loadMoreChats,
            saveChat,
            renameChatFn,
            updateChatTitle,
            newChatMessages,
            setNewChatMessages,
            replaceChatId,
            deleteChatWithUndo,
            leaveChatFn,
        ],
    );

    return (
        <ChatHistoryContext.Provider value={value}>
            {children}
        </ChatHistoryContext.Provider>
    );
}

export function useChatHistoryContext() {
    const context = useContext(ChatHistoryContext);
    if (!context) {
        throw new Error(
            "useChatHistoryContext must be used within a ChatHistoryProvider",
        );
    }
    return context;
}
