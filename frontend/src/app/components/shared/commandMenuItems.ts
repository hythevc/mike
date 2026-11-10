// SPDX-License-Identifier: AGPL-3.0-only
import { NAV_ITEMS, type NavItem } from "@/app/components/shared/navItems";
import {
    SETTINGS_SEARCH_ENTRIES,
    type SettingsSearchEntry,
} from "@/app/lib/settingsSearch";

/**
 * Pure builder for the command menu's grouped, filtered items. It takes only
 * data the app already holds — the navigation list, the settings index and the
 * recent chats, projects and reviews already loaded elsewhere — and never
 * fetches. The component layer sources the recents and renders the result.
 */

export type CommandGroupId = "goto" | "recent" | "actions";
export type CommandActionId = "new-chat" | "open-settings" | "toggle-sidebar";

export interface CommandMenuItem {
    /** Stable id, also the React key and the active-descendant id base. */
    id: string;
    label: string;
    group: CommandGroupId;
    /** Every destination is a real link; actions may omit it. */
    href?: string;
    /** A behaviour the menu runs instead of, or alongside, navigating. */
    action?: CommandActionId;
    /** Trailing context, e.g. the settings tab a control lives under. */
    sublabel?: string;
    /** Extra words the query can match, never shown. */
    keywords?: readonly string[];
}

export interface CommandMenuGroup {
    id: CommandGroupId;
    label: string;
    items: CommandMenuItem[];
}

export interface RecentChatInput {
    id: string;
    title: string | null;
    updated_at?: string | null;
    created_at?: string | null;
}

export interface RecentProjectInput {
    id: string;
    name: string;
    updated_at?: string | null;
    created_at?: string | null;
}

export interface RecentReviewInput {
    id: string;
    name: string;
    updated_at?: string | null;
    created_at?: string | null;
}

export interface BuildCommandMenuInput {
    query: string;
    inOrganization: boolean;
    navItems?: readonly NavItem[];
    settingsEntries?: readonly SettingsSearchEntry[];
    recents?: {
        chats?: readonly RecentChatInput[];
        projects?: readonly RecentProjectInput[];
        reviews?: readonly RecentReviewInput[];
    };
    /** `window.location.search`, so assistant destinations keep `?side=`. */
    currentSearch?: string;
    /** Newest recents to keep across the three kinds. Default 8. */
    recentLimit?: number;
}

const GROUP_LABELS: Record<CommandGroupId, string> = {
    goto: "Go to",
    recent: "Recent",
    actions: "Actions",
};

const DEFAULT_RECENT_LIMIT = 8;
const UNTITLED_CHAT = "New chat";
const UNTITLED_ITEM = "Untitled";

/** Lowercase and strip diacritics, so matching ignores case and accents. */
function fold(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
}

/** Whether every word of the query appears somewhere in the item's text. */
function matches(item: CommandMenuItem, words: string[]): boolean {
    if (words.length === 0) return true;
    const haystack = fold(
        [item.label, item.sublabel, ...(item.keywords ?? [])]
            .filter(Boolean)
            .join(" "),
    );
    return words.every((word) => haystack.includes(word));
}

/** Keep `?side=` when navigating to an assistant route, drop it elsewhere. */
export function withSideParam(href: string, currentSearch?: string): string {
    if (!currentSearch || !href.startsWith("/assistant")) return href;
    const side = new URLSearchParams(currentSearch).get("side");
    if (!side) return href;
    const [path, existing = ""] = href.split("?", 2);
    const params = new URLSearchParams(existing);
    params.set("side", side);
    return `${path}?${params.toString()}`;
}

function activityTime(row: {
    updated_at?: string | null;
    created_at?: string | null;
}): number {
    return Date.parse(row.updated_at || row.created_at || "") || 0;
}

function gotoItems(
    navItems: readonly NavItem[],
    inOrganization: boolean,
    settingsEntries: readonly SettingsSearchEntry[],
): CommandMenuItem[] {
    // Organization-only destinations (Intake) appear only in an organization
    // workspace, matching navItemsForWorkspace's rule.
    const nav = navItems
        .filter((item) => inOrganization || !item.organizationOnly)
        .map(
            (item): CommandMenuItem => ({
                id: `nav:${item.href}`,
                label: item.label,
                group: "goto",
                href: item.href,
            }),
        );
    const settings = settingsEntries.map(
        (entry): CommandMenuItem => ({
            id: `settings:${entry.id}`,
            label: entry.title,
            group: "goto",
            href: entry.href,
            sublabel: entry.tab,
            keywords: entry.keywords,
        }),
    );
    return [...nav, ...settings];
}

function recentItems(
    recents: BuildCommandMenuInput["recents"],
    currentSearch: string | undefined,
    limit: number,
): CommandMenuItem[] {
    const rows: Array<{ item: CommandMenuItem; at: number }> = [];
    for (const chat of recents?.chats ?? []) {
        rows.push({
            at: activityTime(chat),
            item: {
                id: `chat:${chat.id}`,
                label: chat.title?.trim() || UNTITLED_CHAT,
                group: "recent",
                href: withSideParam(`/assistant/chat/${chat.id}`, currentSearch),
                sublabel: "Chat",
            },
        });
    }
    for (const project of recents?.projects ?? []) {
        rows.push({
            at: activityTime(project),
            item: {
                id: `project:${project.id}`,
                label: project.name?.trim() || UNTITLED_ITEM,
                group: "recent",
                href: `/projects/${project.id}`,
                sublabel: "Matter",
            },
        });
    }
    for (const review of recents?.reviews ?? []) {
        rows.push({
            at: activityTime(review),
            item: {
                id: `review:${review.id}`,
                label: review.name?.trim() || UNTITLED_ITEM,
                group: "recent",
                href: `/tabular-reviews/${review.id}`,
                sublabel: "Tabular review",
            },
        });
    }
    return rows
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((row) => row.item);
}

function actionItems(currentSearch: string | undefined): CommandMenuItem[] {
    return [
        {
            id: "action:new-chat",
            label: "New chat",
            group: "actions",
            action: "new-chat",
            href: withSideParam("/assistant", currentSearch),
            keywords: ["start", "compose", "ask"],
        },
        {
            id: "action:open-settings",
            label: "Open settings",
            group: "actions",
            action: "open-settings",
            href: "/settings",
            keywords: ["preferences", "account"],
        },
        {
            id: "action:toggle-sidebar",
            label: "Toggle sidebar",
            group: "actions",
            action: "toggle-sidebar",
            keywords: ["hide", "show", "collapse", "expand", "navigation"],
        },
    ];
}

/**
 * Build the Go to / Recent / Actions groups, filtered by `query`. Empty groups
 * are dropped; `isEmpty` is true when nothing matches (the 'No matches' state).
 */
export function buildCommandMenu(input: BuildCommandMenuInput): {
    groups: CommandMenuGroup[];
    total: number;
    isEmpty: boolean;
} {
    const {
        query,
        inOrganization,
        navItems = NAV_ITEMS,
        settingsEntries = SETTINGS_SEARCH_ENTRIES,
        recents,
        currentSearch,
        recentLimit = DEFAULT_RECENT_LIMIT,
    } = input;

    const words = fold(query).split(/\s+/).filter(Boolean);

    const all: Record<CommandGroupId, CommandMenuItem[]> = {
        goto: gotoItems(navItems, inOrganization, settingsEntries),
        recent: recentItems(recents, currentSearch, recentLimit),
        actions: actionItems(currentSearch),
    };

    const order: CommandGroupId[] = ["goto", "recent", "actions"];
    const groups: CommandMenuGroup[] = [];
    let total = 0;
    for (const id of order) {
        const items = all[id].filter((item) => matches(item, words));
        if (items.length === 0) continue;
        total += items.length;
        groups.push({ id, label: GROUP_LABELS[id], items });
    }

    return { groups, total, isEmpty: total === 0 };
}
