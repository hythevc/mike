// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableHeaderCell,
    TableHeaderRow,
    TableRow,
    TableScrollArea,
    TableSortFilter,
    TableStickyCell,
    type TableSortDirection,
} from "@/app/components/shared/TablePrimitive";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import type { IntakeSortKey, RequestDeskRequest } from "@/app/lib/mikeApi";
import {
    STATUS_ORDER,
    dueDateText,
    personName,
    priorityLabel,
    statusLabel,
} from "./intakeLabels";
import { cn } from "@/app/lib/utils";

const PRIORITY_WIDTH = "w-24";
const ASSIGNEE_WIDTH = "w-44";
const DUE_WIDTH = "w-44";

export interface IntakeSortState {
    key: IntakeSortKey;
    direction: TableSortDirection;
}

export interface IntakeRequestsTableProps {
    requests: RequestDeskRequest[];
    loading: boolean;
    error: boolean;
    /** A status, priority, assignee or due-date filter is narrowing the list. */
    hasActiveFilters: boolean;
    selectedRequestId: string | null;
    sort: IntakeSortState | null;
    onSortChange: (key: IntakeSortKey, direction: TableSortDirection | null) => void;
    onOpenRequest: (request: RequestDeskRequest) => void;
    onRetry: () => void;
    onClearFilters: () => void;
    onNewRequest: () => void;
    canCreate: boolean;
}

function sortDirectionFor(
    sort: IntakeSortState | null,
    key: IntakeSortKey,
): TableSortDirection | null {
    return sort?.key === key ? sort.direction : null;
}

/** Requests split into their status groups, in the board's fixed order. */
function groupByStatus(
    requests: RequestDeskRequest[],
): { status: (typeof STATUS_ORDER)[number]; requests: RequestDeskRequest[] }[] {
    return STATUS_ORDER.map((status) => ({
        status,
        requests: requests.filter((request) => request.status === status),
    })).filter((group) => group.requests.length > 0);
}

export function IntakeRequestsTable({
    requests,
    loading,
    error,
    hasActiveFilters,
    selectedRequestId,
    sort,
    onSortChange,
    onOpenRequest,
    onRetry,
    onClearFilters,
    onNewRequest,
    canCreate,
}: IntakeRequestsTableProps) {
    const groups = groupByStatus(requests);

    return (
        <TableScrollArea
            header={
                <TableHeaderRow>
                    <TableStickyCell header>
                        <span className="mr-1">Request</span>
                        {!loading && (
                            <TableSortFilter
                                label="Sort by reference"
                                value={sortDirectionFor(sort, "reference")}
                                onChange={(direction) =>
                                    onSortChange("reference", direction)
                                }
                            />
                        )}
                    </TableStickyCell>
                    <TableHeaderCell className={cn("ml-auto", PRIORITY_WIDTH)}>
                        <div className="flex items-center gap-1">
                            <span>Priority</span>
                            {!loading && (
                                <TableSortFilter
                                    label="Sort by priority"
                                    value={sortDirectionFor(sort, "priority")}
                                    onChange={(direction) =>
                                        onSortChange("priority", direction)
                                    }
                                />
                            )}
                        </div>
                    </TableHeaderCell>
                    <TableHeaderCell className={ASSIGNEE_WIDTH}>
                        Assignee
                    </TableHeaderCell>
                    <TableHeaderCell className={DUE_WIDTH}>
                        <div className="flex items-center gap-1">
                            <span>Due date</span>
                            {!loading && (
                                <TableSortFilter
                                    label="Sort by due date"
                                    value={sortDirectionFor(sort, "due")}
                                    onChange={(direction) =>
                                        onSortChange("due", direction)
                                    }
                                />
                            )}
                        </div>
                    </TableHeaderCell>
                </TableHeaderRow>
            }
        >
            {loading ? (
                <IntakeLoadingRows />
            ) : error ? (
                <TableEmptyState>
                    <p className="font-serif text-lg font-medium text-gray-900">
                        Unable to load requests
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                        Check your connection and try again.
                    </p>
                    <PillButtonUI
                        tone="black"
                        size="sm"
                        onClick={onRetry}
                        className="mt-4"
                    >
                        Try again
                    </PillButtonUI>
                </TableEmptyState>
            ) : requests.length === 0 ? (
                <TableEmptyState>
                    {hasActiveFilters ? (
                        <>
                            <p className="font-serif text-lg font-medium text-gray-900">
                                No matching requests
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                                No requests match the current filters.
                            </p>
                            <PillButtonUI
                                tone="white"
                                size="sm"
                                onClick={onClearFilters}
                                className="mt-4"
                            >
                                Clear filters
                            </PillButtonUI>
                        </>
                    ) : (
                        <EmptyState
                            icon={<IntakeSkeuoIcon />}
                            title="No requests yet"
                            description="Requests the team logs, and any that come in through the request form, show up here to triage and turn into matters."
                            action={
                                <PillButtonUI
                                    tone="black"
                                    size="sm"
                                    onClick={onNewRequest}
                                    disabled={!canCreate}
                                >
                                    New request
                                </PillButtonUI>
                            }
                        />
                    )}
                </TableEmptyState>
            ) : (
                <TableBody>
                    {groups.map((group) => (
                        <div key={group.status}>
                            <div
                                className="flex h-8 min-w-max items-center px-3 pt-2 text-xs font-semibold text-gray-700"
                                data-slot="intake-group-heading"
                            >
                                {statusLabel(group.status)}
                                <span className="ml-1.5 font-normal text-gray-400">
                                    {group.requests.length}
                                </span>
                            </div>
                            {group.requests.map((request) => (
                                <IntakeRequestRow
                                    key={request.id}
                                    request={request}
                                    selected={request.id === selectedRequestId}
                                    onOpen={() => onOpenRequest(request)}
                                />
                            ))}
                        </div>
                    ))}
                </TableBody>
            )}
        </TableScrollArea>
    );
}

function IntakeRequestRow({
    request,
    selected,
    onOpen,
}: {
    request: RequestDeskRequest;
    selected: boolean;
    onOpen: () => void;
}) {
    const due = dueDateText(request);
    return (
        <TableRow selected={selected} onClick={onOpen}>
            <TableStickyCell hover={!selected}>
                <div className="flex min-w-0 flex-col py-0.5">
                    {/* A focusable control so the row opens from the keyboard,
                        with an accessible name the panel is announced by. */}
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen();
                        }}
                        className="min-w-0 truncate text-left text-xs font-medium text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                        {request.title}
                    </button>
                    <span className="truncate text-[11px] text-gray-400">
                        {request.reference}
                    </span>
                </div>
            </TableStickyCell>
            <TableCell className={cn("ml-auto text-gray-700", PRIORITY_WIDTH)}>
                {priorityLabel(request.priority)}
            </TableCell>
            <TableCell className={ASSIGNEE_WIDTH}>
                {request.assignee ? (
                    personName(request.assignee)
                ) : (
                    <span className="text-fg-muted">Unassigned</span>
                )}
            </TableCell>
            <TableCell className={DUE_WIDTH}>
                {due ? (
                    <span className={request.is_overdue ? "text-gray-700" : undefined}>
                        {due}
                    </span>
                ) : (
                    <span className="text-fg-muted">—</span>
                )}
            </TableCell>
        </TableRow>
    );
}

function IntakeLoadingRows() {
    const titleWidths = ["w-40", "w-52", "w-36", "w-48", "w-44"];
    return (
        <TableBody>
            {titleWidths.map((width, index) => (
                <TableRow key={index} interactive={false}>
                    <TableStickyCell hover={false}>
                        <div className="flex min-w-0 flex-col gap-1 py-0.5">
                            <SkeletonLine className={cn("h-3.5", width)} />
                            <SkeletonLine className="w-16" />
                        </div>
                    </TableStickyCell>
                    <TableCell className={cn("ml-auto", PRIORITY_WIDTH)}>
                        <SkeletonLine className="w-14" />
                    </TableCell>
                    <TableCell className={ASSIGNEE_WIDTH}>
                        <SkeletonLine className="w-24" />
                    </TableCell>
                    <TableCell className={DUE_WIDTH}>
                        <SkeletonLine className="w-20" />
                    </TableCell>
                </TableRow>
            ))}
        </TableBody>
    );
}
