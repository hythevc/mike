// SPDX-License-Identifier: AGPL-3.0-only
//
// Plain-text vocabulary for the request desk. Status, priority and the overdue
// flag are shown as words, never colour alone, so the board reads the same for
// everyone (AGENTS.md, and the accessibility baseline).

import type {
    RequestDeskPriority,
    RequestDeskRequest,
    RequestDeskStatus,
} from "@/app/lib/mikeApi";

/** The order statuses are grouped and listed in, open before terminal. */
export const STATUS_ORDER: readonly RequestDeskStatus[] = [
    "new",
    "in_progress",
    "waiting",
    "closed",
    "declined",
];

export const STATUS_LABELS: Record<RequestDeskStatus, string> = {
    new: "New",
    in_progress: "In progress",
    waiting: "Waiting",
    closed: "Closed",
    declined: "Declined",
};

/** Open statuses a request can still move between before it is resolved. */
export const OPEN_STATUSES: readonly RequestDeskStatus[] = [
    "new",
    "in_progress",
    "waiting",
];

/** Most pressing first, for filter menus and the priority column order. */
export const PRIORITY_ORDER: readonly RequestDeskPriority[] = [
    "urgent",
    "high",
    "normal",
    "low",
];

export const PRIORITY_LABELS: Record<RequestDeskPriority, string> = {
    low: "Low",
    normal: "Normal",
    high: "High",
    urgent: "Urgent",
};

export function statusLabel(status: RequestDeskStatus): string {
    return STATUS_LABELS[status];
}

export function priorityLabel(priority: RequestDeskPriority): string {
    return PRIORITY_LABELS[priority];
}

/** The sort keys the list offers, with their column labels. */
export const SORT_LABELS: Record<
    "created" | "updated" | "due" | "priority" | "reference",
    string
> = {
    reference: "Reference",
    priority: "Priority",
    due: "Due date",
    created: "Created",
    updated: "Updated",
};

/**
 * The due-date line for a request: the date, and " · Overdue" as words when an
 * open request is past it. Returns null when there is no due date to show.
 */
export function dueDateText(request: RequestDeskRequest): string | null {
    if (!request.sla_due_at) return null;
    const date = new Date(request.sla_due_at);
    if (Number.isNaN(date.getTime())) return null;
    const formatted = date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
    return request.is_overdue ? `${formatted} · Overdue` : formatted;
}

/** The name to show for a person, falling back to their email, then a dash. */
export function personName(
    person: { display_name: string | null; email: string | null } | null,
): string {
    return person?.display_name?.trim() || person?.email?.trim() || "—";
}
