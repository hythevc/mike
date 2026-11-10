// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { SearchBar } from "@/app/components/ui/search-bar";
import { ModalUI } from "@/shared/ui/ModalUI";
import { Kbd } from "@/app/components/ui/kbd";
import { DropdownSurface } from "@/shared/ui/dropdown";
import { cn } from "@/app/lib/utils";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { useCommandMenuShortcut } from "@/app/hooks/useCommandMenuShortcut";
import {
    buildCommandMenu,
    type CommandActionId,
    type CommandMenuItem,
    type RecentChatInput,
    type RecentProjectInput,
    type RecentReviewInput,
} from "@/app/components/shared/commandMenuItems";
import {
    COMMAND_MENU_LABELS,
    KEYBOARD_SHORTCUTS,
    KEYBOARD_SHORTCUTS_TITLE,
} from "@/app/components/shared/helpMenuLabels";

interface CommandMenuContextValue {
    openCommandMenu: () => void;
    openKeyboardShortcuts: () => void;
}

// A no-op default so the sidebar trigger renders harmlessly in isolation
// (tests, stories); inside the app the provider supplies the real openers.
const CommandMenuContext = React.createContext<CommandMenuContextValue>({
    openCommandMenu: () => {},
    openKeyboardShortcuts: () => {},
});

/** Open the command menu or the keyboard-shortcuts dialog from anywhere. */
export function useCommandMenu(): CommandMenuContextValue {
    return React.useContext(CommandMenuContext);
}

export interface CommandMenuRecents {
    chats: RecentChatInput[];
    projects: RecentProjectInput[];
    reviews: RecentReviewInput[];
}

/**
 * Mounts the command menu and the keyboard-shortcuts dialog once, binds
 * Cmd/Ctrl+K, and exposes openers through context. Recents come from the
 * already-loaded chat history — no new fetch.
 */
export function CommandMenuProvider({
    children,
    onToggleSidebar,
    recents,
}: {
    children: React.ReactNode;
    onToggleSidebar: () => void;
    /** Test seam: inject recents instead of reading the chat history. */
    recents?: CommandMenuRecents;
}): React.ReactElement {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
    const { captureOpener } = useCommandMenuShortcut({
        open: menuOpen,
        setOpen: setMenuOpen,
    });

    const chatHistory = useChatHistoryContext();
    const { activeOrganization } = useWorkspace();

    const liveRecents = React.useMemo<CommandMenuRecents>(() => {
        if (recents) return recents;
        // Standalone chats link to /assistant/chat/:id; project chats live
        // under their matter and are reached from there.
        const chats = (chatHistory.chats ?? [])
            .filter((chat) => !chat.project_id)
            .map((chat) => ({
                id: chat.id,
                title: chat.title,
                updated_at: chat.updated_at,
                created_at: chat.created_at,
            }));
        return { chats, projects: [], reviews: [] };
    }, [recents, chatHistory.chats]);

    const value = React.useMemo<CommandMenuContextValue>(
        () => ({
            openCommandMenu: () => {
                captureOpener();
                setMenuOpen(true);
            },
            openKeyboardShortcuts: () => setShortcutsOpen(true),
        }),
        [captureOpener],
    );

    const runAction = React.useCallback(
        (action: CommandActionId) => {
            if (action === "toggle-sidebar") onToggleSidebar();
        },
        [onToggleSidebar],
    );

    return (
        <CommandMenuContext.Provider value={value}>
            {children}
            <CommandMenuDialog
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                inOrganization={Boolean(activeOrganization)}
                recents={liveRecents}
                onRunAction={runAction}
            />
            <KeyboardShortcutsDialog
                open={shortcutsOpen}
                onClose={() => setShortcutsOpen(false)}
            />
        </CommandMenuContext.Provider>
    );
}

const PANEL_ENTER_CLASS =
    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.98] " +
    "animation-duration-(--motion-duration-enter) ease-out-strong";

export function CommandMenuDialog({
    open,
    onClose,
    inOrganization,
    recents,
    onRunAction,
}: {
    open: boolean;
    onClose: () => void;
    inOrganization: boolean;
    recents: CommandMenuRecents;
    onRunAction: (action: CommandActionId) => void;
}): React.ReactElement | null {
    const [query, setQuery] = React.useState("");
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [search, setSearch] = React.useState("");
    const [mounted, setMounted] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const titleId = React.useId();
    const listboxId = React.useId();

    React.useEffect(() => setMounted(true), []);

    React.useEffect(() => {
        if (!open) return;
        setQuery("");
        setActiveIndex(0);
        setSearch(window.location.search);
        const id = window.requestAnimationFrame(() => inputRef.current?.focus());
        return () => window.cancelAnimationFrame(id);
    }, [open]);

    const { groups, isEmpty } = buildCommandMenu({
        query,
        inOrganization,
        recents,
        currentSearch: search,
    });
    const flat = React.useMemo(
        () => groups.flatMap((group) => group.items),
        [groups],
    );
    const clampedActive = flat.length === 0 ? -1 : Math.min(activeIndex, flat.length - 1);
    const optionId = (index: number) => `${listboxId}-option-${index}`;

    // A mouse click on an option: a link lets its href carry the navigation,
    // so this only runs an action and closes.
    function selectItem(item: CommandMenuItem) {
        if (item.action && !item.href) onRunAction(item.action);
        onClose();
    }

    // Enter activates the highlighted option. For a link, clicking its node
    // runs the same path a mouse would (selectItem via the link's onClick, then
    // the href navigates); an action runs directly.
    function activate() {
        const item = flat[clampedActive];
        if (!item) return;
        if (item.href) {
            document.getElementById(optionId(clampedActive))?.click();
            return;
        }
        selectItem(item);
    }

    function onKeyDown(event: React.KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key === "Tab") {
            // Single-field palette: keep focus in the search input.
            event.preventDefault();
            return;
        }
        if (flat.length === 0) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % flat.length);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
        } else if (event.key === "Home") {
            event.preventDefault();
            setActiveIndex(0);
        } else if (event.key === "End") {
            event.preventDefault();
            setActiveIndex(flat.length - 1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            activate();
        }
    }

    if (!open || !mounted) return null;

    // The flat index each group's options start at, so an option's position in
    // the listbox matches its position in `flat` (what the arrow keys move).
    const groupStart = groups.map((_, groupIndex) =>
        groups
            .slice(0, groupIndex)
            .reduce((total, entry) => total + entry.items.length, 0),
    );
    return createPortal(
        <div
            className="fixed inset-0 z-[250] flex items-start justify-center px-4 pb-4 pt-[12vh]"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-white/10 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in-0 animation-duration-(--motion-duration-fast)"
            />
            <DropdownSurface
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className={cn(
                    "relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden",
                    PANEL_ENTER_CLASS,
                )}
            >
                <h2 id={titleId} className="sr-only">
                    {COMMAND_MENU_LABELS.title}
                </h2>
                <div className="p-2">
                    <SearchBar
                        ref={inputRef}
                        value={query}
                        onValueChange={(next) => {
                            setQuery(next);
                            setActiveIndex(0);
                        }}
                        label={COMMAND_MENU_LABELS.searchLabel}
                        placeholder={COMMAND_MENU_LABELS.placeholder}
                        role="combobox"
                        aria-expanded
                        aria-controls={listboxId}
                        aria-autocomplete="list"
                        aria-activedescendant={
                            clampedActive >= 0 ? optionId(clampedActive) : undefined
                        }
                        onKeyDown={onKeyDown}
                    />
                </div>
                {isEmpty ? (
                    <div
                        id={listboxId}
                        role="listbox"
                        aria-label={COMMAND_MENU_LABELS.title}
                        className="px-4 pb-6 pt-2"
                    >
                        <p className="text-sm font-medium text-fg">
                            {COMMAND_MENU_LABELS.empty}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-muted">
                            {COMMAND_MENU_LABELS.emptyHint}
                        </p>
                    </div>
                ) : (
                    <div
                        id={listboxId}
                        role="listbox"
                        aria-label={COMMAND_MENU_LABELS.title}
                        className="flex-1 overflow-y-auto overflow-x-hidden px-1 pb-2"
                    >
                        {groups.map((group, groupIndex) => {
                            const headingId = `${listboxId}-group-${group.id}`;
                            return (
                                <div
                                    key={group.id}
                                    role="group"
                                    aria-labelledby={headingId}
                                    className="mb-1"
                                >
                                    <div
                                        id={headingId}
                                        className="px-3 pb-1 pt-2 text-[11px] font-medium text-fg-muted"
                                    >
                                        {group.label}
                                    </div>
                                    {group.items.map((item, itemIndex) => {
                                        const position =
                                            groupStart[groupIndex]! + itemIndex;
                                        return (
                                            <CommandOption
                                                key={item.id}
                                                item={item}
                                                id={optionId(position)}
                                                active={position === clampedActive}
                                                onSelect={() => selectItem(item)}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                )}
            </DropdownSurface>
        </div>,
        document.body,
    );
}

const OPTION_CLASS =
    "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg outline-none";

function CommandOption({
    item,
    id,
    active,
    onSelect,
}: {
    item: CommandMenuItem;
    id: string;
    active: boolean;
    onSelect: () => void;
}): React.ReactElement {
    const body = (
        <>
            <span className="min-w-0 truncate">{item.label}</span>
            {item.sublabel ? (
                <span className="shrink-0 text-xs text-fg-muted">
                    {item.sublabel}
                </span>
            ) : null}
        </>
    );
    const className = cn(OPTION_CLASS, active && "liquid-glass-selected");
    if (item.href) {
        return (
            <Link
                id={id}
                href={item.href}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                className={className}
                onClick={onSelect}
            >
                {body}
            </Link>
        );
    }
    return (
        <button
            id={id}
            type="button"
            role="option"
            aria-selected={active}
            tabIndex={-1}
            className={className}
            onClick={onSelect}
        >
            {body}
        </button>
    );
}

export function KeyboardShortcutsDialog({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}): React.ReactElement {
    return (
        <ModalUI
            open={open}
            onClose={onClose}
            ariaLabel={KEYBOARD_SHORTCUTS_TITLE}
            breadcrumbs={[KEYBOARD_SHORTCUTS_TITLE]}
            size="sm"
        >
            <ul className="flex flex-col gap-2 pb-5 pt-1" data-modal-scroll>
                {KEYBOARD_SHORTCUTS.map((shortcut) => (
                    <li
                        key={shortcut.keys.join("+")}
                        className="flex items-center justify-between gap-4"
                    >
                        <span className="min-w-0 text-sm text-fg">
                            {shortcut.description}
                        </span>
                        <Kbd keys={shortcut.keys} className="shrink-0" />
                    </li>
                ))}
            </ul>
        </ModalUI>
    );
}
