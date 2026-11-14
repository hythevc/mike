// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
    useCallback,
    useEffect,
    useRef,
    type Dispatch,
    type SetStateAction,
} from "react";

/**
 * Binds Cmd/Ctrl+K to toggle the command menu, and returns focus to whatever
 * opened it when it closes.
 *
 * The shortcut is ignored when the event was already handled
 * (`defaultPrevented`) or was raised inside a rich editor — the DOCX editor,
 * the Markdown editor, or the spreadsheet grid — where Cmd/Ctrl+K is the
 * editor's own (a link, a cell edit).
 *
 * The returned `captureOpener` lets another opener (the sidebar trigger)
 * record the element to restore focus to, so a menu opened by the button also
 * returns focus to it.
 */

// The editors that own Cmd/Ctrl+K for themselves.
const EDITOR_SELECTOR =
    ".docx-editor, .markdown-editor-content, .fortune-container";

export function useCommandMenuShortcut({
    open,
    setOpen,
}: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
}): { captureOpener: () => void } {
    const openerRef = useRef<HTMLElement | null>(null);
    const wasOpen = useRef(open);

    const captureOpener = useCallback(() => {
        openerRef.current = document.activeElement as HTMLElement | null;
    }, []);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.defaultPrevented) return;
            if (
                event.key.toLowerCase() !== "k" ||
                !(event.metaKey || event.ctrlKey) ||
                event.altKey ||
                event.shiftKey
            ) {
                return;
            }
            const target = event.target;
            if (target instanceof Element && target.closest(EDITOR_SELECTOR)) {
                return;
            }
            event.preventDefault();
            setOpen((prev) => {
                if (!prev) captureOpener();
                return !prev;
            });
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [setOpen, captureOpener]);

    useEffect(() => {
        if (wasOpen.current && !open) {
            const opener = openerRef.current;
            openerRef.current = null;
            opener?.focus?.();
        }
        wasOpen.current = open;
    }, [open]);

    return { captureOpener };
}
