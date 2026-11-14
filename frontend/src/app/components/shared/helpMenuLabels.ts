// SPDX-License-Identifier: AGPL-3.0-only
import type { KbdToken } from "@/app/components/ui/kbd";
import { TOAST_FOCUS_KEY } from "@/shared/ui/ToastUI";

/**
 * Copy for the command menu, the keyboard-shortcuts dialog and the help menu.
 * Kept in one place so every string is read as one voice; destinations come
 * from the brand module, never from here.
 */

export const COMMAND_MENU_LABELS = {
    title: "Command menu",
    placeholder: "Search for a page, setting or recent item",
    searchLabel: "Search the command menu",
    triggerLabel: "Search",
    empty: "No matches",
    emptyHint: "Try a different word.",
} as const;

export interface KeyboardShortcut {
    keys: KbdToken[];
    description: string;
}

export const KEYBOARD_SHORTCUTS_TITLE = "Keyboard shortcuts";

// Only shortcuts the app really binds. F8 is ToastUI's focus key; the
// selection modifiers are the ones the data tables read on a row click.
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
    { keys: ["mod", "K"], description: "Open the command menu" },
    {
        keys: [TOAST_FOCUS_KEY],
        description: "Move focus to the newest notification that needs an action",
    },
    { keys: ["escape"], description: "Close a menu, dialog or overlay" },
    { keys: ["shift", "Click"], description: "Select a range of rows in a table" },
    {
        keys: ["mod", "Click"],
        description: "Add or remove a single row from a table selection",
    },
];

export const HELP_MENU_LABELS = {
    trigger: "Help",
    documentation: "Documentation",
    keyboardShortcuts: KEYBOARD_SHORTCUTS_TITLE,
    support: "Support",
    about: "About",
    sourceCode: "Source code",
    terms: "Terms",
    privacy: "Privacy",
} as const;
