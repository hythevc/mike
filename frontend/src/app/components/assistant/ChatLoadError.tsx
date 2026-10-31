// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { CSSProperties } from "react";
import { ChatSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { EmptyState } from "@/app/components/ui/empty-state";
import { cn } from "@/app/lib/utils";
import type { UserFacingError } from "@/app/lib/userFacingError";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

/** Why a chat could not be shown: its load failed, or it holds no messages. */
export type ChatLoadFailure =
    | { kind: "failed"; error: UserFacingError }
    | { kind: "empty" };

interface Props {
    failure: ChatLoadFailure;
    /** Loads the same chat again. */
    onRetry: () => void;
    /** Leaves for the new-chat view; only ever on the person's request. */
    onStartNewChat: () => void;
    /** Which pane of the assistant page this replaces. */
    paneId: "primary" | "side";
    /** The pane's share of the width when two chats split the page. */
    widthShare?: number;
}

/**
 * Takes the place of a chat that could not be shown. The page stays on the
 * chat's address and says what happened, instead of quietly swapping in a
 * blank chat that reads as "your conversation is gone".
 */
export function ChatLoadError({
    failure,
    onRetry,
    onStartNewChat,
    paneId,
    widthShare,
}: Props) {
    const failed = failure.kind === "failed";
    // A refusal or a missing chat will not change on a second attempt;
    // an empty chat may still be saving its first answer.
    const canRetry = failed ? failure.error.retryable : true;

    return (
        <div
            data-chat-pane={paneId}
            className={cn(
                "relative h-full min-w-0 flex-1 items-center justify-center px-6",
                widthShare !== undefined &&
                    "md:[flex-grow:var(--chat-width-share)]",
                paneId === "side" ? "hidden md:flex" : "flex",
            )}
            style={
                widthShare === undefined
                    ? undefined
                    : ({
                          "--chat-width-share": widthShare,
                      } as CSSProperties)
            }
        >
            <div role="alert" className="w-full max-w-sm">
                <EmptyState
                    icon={<ChatSkeuoIcon />}
                    title={
                        failed
                            ? failure.error.title
                            : "This chat has no messages"
                    }
                    description={
                        failed
                            ? failure.error.message
                            : "Nothing has been saved in this chat yet. Try loading it again, or start a new chat."
                    }
                    tone={failed ? "error" : "default"}
                    action={
                        <div className="flex flex-wrap items-center gap-2">
                            <PillButtonUI
                                type="button"
                                tone={canRetry ? "white" : "black"}
                                size="sm"
                                onClick={onStartNewChat}
                            >
                                Start a new chat
                            </PillButtonUI>
                            {canRetry && (
                                <PillButtonUI
                                    type="button"
                                    tone="black"
                                    size="sm"
                                    onClick={onRetry}
                                >
                                    Retry
                                </PillButtonUI>
                            )}
                        </div>
                    }
                />
            </div>
        </div>
    );
}
