// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { CHAT_DELETE_UNDO_MS } from "@/app/lib/chatDeleteUndo";

/**
 * The question asked before a chat is deleted from the sidebar or from the
 * chat's own menu. Confirming hands the chat to `deleteChatWithUndo`, which
 * still offers Undo before anything is sent.
 */
export function DeleteChatConfirmPopup({
    open,
    chatTitle,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    chatTitle: string | null | undefined;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const title = chatTitle?.trim() || "Untitled chat";
    const undoSeconds = Math.round(CHAT_DELETE_UNDO_MS / 1000);
    return (
        <ConfirmPopup
            open={open}
            title="Delete chat?"
            message={`“${title}” and its messages will be deleted. You can undo this for ${undoSeconds} seconds.`}
            confirmLabel="Delete"
            confirmVariant="danger"
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}
