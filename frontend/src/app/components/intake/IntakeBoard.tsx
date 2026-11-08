// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { PAGE_HEADER_TITLE_CLASS } from "@/app/components/shared/pageHeaderStyles";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { useAuth } from "@/app/contexts/AuthContext";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { isOrgAdmin } from "@/app/lib/permissions";
import { reportFault } from "@/app/lib/userFacingError";
import { headerButtonClassName } from "@/shared/ui/HeaderButtonsUI";
import {
    getIntakeBoard,
    listIntakeRequests,
    type IntakeRequestFilters,
    type IntakeSortKey,
    type RequestDeskBoardSummary,
    type RequestDeskPriority,
    type RequestDeskRequest,
    type RequestDeskStatus,
} from "@/app/lib/mikeApi";
import type { TableSortDirection } from "@/app/components/shared/TablePrimitive";
import {
    IntakeRequestsTable,
    type IntakeSortState,
} from "./IntakeRequestsTable";
import { IntakeRequestPanel } from "./IntakeRequestPanel";
import { NewRequestModal } from "./NewRequestModal";
import {
    OPEN_STATUSES,
    PRIORITY_ORDER,
    STATUS_ORDER,
    priorityLabel,
    statusLabel,
} from "./intakeLabels";
import { cn } from "@/app/lib/utils";

type StatusFilter = RequestDeskStatus | "open" | "";
type AssigneeFilter = "me" | "none" | "";

const PAGE_SIZE = 100;

interface FilterState {
    status: StatusFilter;
    priority: RequestDeskPriority | "";
    assignee: AssigneeFilter;
    overdue: boolean;
    dueBefore: string;
}

const EMPTY_FILTERS: FilterState = {
    status: "",
    priority: "",
    assignee: "",
    overdue: false,
    dueBefore: "",
};

function toApiFilters(
    filters: FilterState,
    sort: IntakeSortState | null,
): IntakeRequestFilters {
    const statuses =
        filters.status === ""
            ? undefined
            : filters.status === "open"
              ? [...OPEN_STATUSES]
              : [filters.status];
    return {
        statuses,
        priorities: filters.priority ? [filters.priority] : undefined,
        assignee: filters.assignee || undefined,
        overdue: filters.overdue || undefined,
        dueBefore: filters.dueBefore || undefined,
        sortKey: sort?.key,
        sortDirection: sort?.direction,
        limit: PAGE_SIZE,
    };
}

export function IntakeBoard({ workspace }: { workspace: string }) {
    const { user } = useAuth();
    // Request forms are managed by owners and admins; the link to them is
    // offered only once the caller's role is known to allow it.
    const { activeOrganization } = useWorkspace();
    const canManageForms =
        activeOrganization?.id === workspace && isOrgAdmin(activeOrganization.role);
    const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
    const [sort, setSort] = useState<IntakeSortState | null>(null);
    const [requests, setRequests] = useState<RequestDeskRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [board, setBoard] = useState<RequestDeskBoardSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [listReloadKey, setListReloadKey] = useState(0);
    const [boardReloadKey, setBoardReloadKey] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [newRequestOpen, setNewRequestOpen] = useState(false);

    const hasActiveFilters =
        filters.status !== "" ||
        filters.priority !== "" ||
        filters.assignee !== "" ||
        filters.overdue ||
        filters.dueBefore !== "";

    const apiFilters = toApiFilters(filters, sort);
    // Primitive dependencies, so the request re-runs when any filter or sort
    // changes without depending on a fresh object each render.
    const filterKey = JSON.stringify(apiFilters);

    useEffect(() => {
        const controller = new AbortController();
        /* eslint-disable react-hooks/set-state-in-effect -- show the loading
           state the moment the workspace, filters or sort change, before the
           request is sent */
        setLoading(true);
        setError(false);
        /* eslint-enable react-hooks/set-state-in-effect */
        (async () => {
            try {
                const page = await listIntakeRequests(
                    workspace,
                    JSON.parse(filterKey) as IntakeRequestFilters,
                    controller.signal,
                );
                if (controller.signal.aborted) return;
                setRequests(page.requests);
                setTotal(page.total);
                setLoading(false);
            } catch (caught) {
                if (controller.signal.aborted) return;
                setError(true);
                setLoading(false);
                reportFault(caught, {
                    action: "load the request desk",
                    operation: "intake.requests",
                });
            }
        })();
        return () => controller.abort();
    }, [workspace, filterKey, listReloadKey]);

    // The board counts load alongside the list and never block it: if they
    // fail, the overview line is simply not shown.
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const summary = await getIntakeBoard(workspace, controller.signal);
                if (!controller.signal.aborted) setBoard(summary);
            } catch {
                if (!controller.signal.aborted) setBoard(null);
            }
        })();
        return () => controller.abort();
    }, [workspace, boardReloadKey]);

    const refreshBoard = useCallback(
        () => setBoardReloadKey((key) => key + 1),
        [],
    );
    // An explicit retry reloads the list (with its skeleton) and the counts.
    const retry = useCallback(() => {
        setListReloadKey((key) => key + 1);
        setBoardReloadKey((key) => key + 1);
    }, []);

    const onSortChange = useCallback(
        (key: IntakeSortKey, direction: TableSortDirection | null) => {
            setSort(direction ? { key, direction } : null);
        },
        [],
    );

    const handleRequestChanged = useCallback(
        (updated: RequestDeskRequest) => {
            // The changed request is updated in place, so the board never
            // flashes its skeleton behind the open panel; only the overview
            // counts, which the change may have moved, are refreshed.
            setRequests((current) =>
                current.map((request) =>
                    request.id === updated.id ? updated : request,
                ),
            );
            refreshBoard();
        },
        [refreshBoard],
    );

    const handleCreated = useCallback(
        (created: RequestDeskRequest) => {
            setNewRequestOpen(false);
            setRequests((current) => [
                created,
                ...current.filter((request) => request.id !== created.id),
            ]);
            setSelectedId(created.id);
            refreshBoard();
        },
        [refreshBoard],
    );

    const selected = requests.find((request) => request.id === selectedId) ?? null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <PageHeader
                actions={[
                    canManageForms && {
                        type: "custom",
                        render: (
                            // A destination, so a link: it opens in a new tab
                            // and announces where it goes.
                            <Link href="/intake/forms" className={headerButtonClassName()}>
                                Request forms
                            </Link>
                        ),
                    },
                    {
                        type: "new",
                        onClick: () => setNewRequestOpen(true),
                        title: "New request",
                    },
                ]}
            >
                <h1 className={`${PAGE_HEADER_TITLE_CLASS} text-gray-900`}>Intake</h1>
            </PageHeader>

            {board && (
                <p className="mx-3 mb-1 text-xs text-gray-500 md:mx-6.5">
                    {board.open} open · {board.overdue} overdue · {board.unassigned}{" "}
                    unassigned · {board.assigned_to_me} assigned to you
                </p>
            )}

            <IntakeFilterBar
                filters={filters}
                onChange={setFilters}
                hasActiveFilters={hasActiveFilters}
                onClear={() => setFilters(EMPTY_FILTERS)}
            />

            <div className="flex min-h-0 flex-1 md:gap-3">
                <div
                    className={cn(
                        "min-w-0 flex-1 flex-col",
                        selected ? "hidden md:flex" : "flex",
                    )}
                >
                    <IntakeRequestsTable
                        requests={requests}
                        loading={loading}
                        error={error}
                        hasActiveFilters={hasActiveFilters}
                        selectedRequestId={selectedId}
                        sort={sort}
                        onSortChange={onSortChange}
                        onOpenRequest={(request) => setSelectedId(request.id)}
                        onRetry={retry}
                        onClearFilters={() => setFilters(EMPTY_FILTERS)}
                        onNewRequest={() => setNewRequestOpen(true)}
                        canCreate
                    />
                    {!loading && !error && total > requests.length && (
                        <p className="mx-3 mb-3 text-xs text-gray-400 md:mx-6.5">
                            Showing the first {requests.length} of {total} requests.
                            Narrow the filters to see the rest.
                        </p>
                    )}
                </div>
                {selected && (
                    <div className="flex w-full min-h-0 flex-col pb-2 pr-2 md:w-96 md:flex-none md:pb-3 md:pr-3">
                        <IntakeRequestPanel
                            request={selected}
                            currentUserEmail={user?.email}
                            onClose={() => setSelectedId(null)}
                            onRequestChanged={handleRequestChanged}
                        />
                    </div>
                )}
            </div>

            <NewRequestModal
                open={newRequestOpen}
                workspace={workspace}
                onClose={() => setNewRequestOpen(false)}
                onCreated={handleCreated}
            />
        </div>
    );
}

function IntakeFilterBar({
    filters,
    onChange,
    hasActiveFilters,
    onClear,
}: {
    filters: FilterState;
    onChange: (filters: FilterState) => void;
    hasActiveFilters: boolean;
    onClear: () => void;
}) {
    const selectClass = cn(FORM_CONTROL_GLASS_CLASS, "h-8 w-auto px-2 text-xs");
    return (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 md:mx-6.5">
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Status
                <select
                    className={selectClass}
                    value={filters.status}
                    onChange={(event) =>
                        onChange({
                            ...filters,
                            status: event.target.value as StatusFilter,
                        })
                    }
                >
                    <option value="">All statuses</option>
                    <option value="open">Open</option>
                    {STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                            {statusLabel(status)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Priority
                <select
                    className={selectClass}
                    value={filters.priority}
                    onChange={(event) =>
                        onChange({
                            ...filters,
                            priority: event.target.value as RequestDeskPriority | "",
                        })
                    }
                >
                    <option value="">All priorities</option>
                    {PRIORITY_ORDER.map((priority) => (
                        <option key={priority} value={priority}>
                            {priorityLabel(priority)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Assignee
                <select
                    className={selectClass}
                    value={filters.assignee}
                    onChange={(event) =>
                        onChange({
                            ...filters,
                            assignee: event.target.value as AssigneeFilter,
                        })
                    }
                >
                    <option value="">Anyone</option>
                    <option value="me">Assigned to me</option>
                    <option value="none">Unassigned</option>
                </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Due before
                <input
                    type="date"
                    className={selectClass}
                    value={filters.dueBefore}
                    onChange={(event) =>
                        onChange({ ...filters, dueBefore: event.target.value })
                    }
                />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-300 accent-black"
                    checked={filters.overdue}
                    onChange={(event) =>
                        onChange({ ...filters, overdue: event.target.checked })
                    }
                />
                Overdue only
            </label>
            {hasActiveFilters && (
                <button
                    type="button"
                    onClick={onClear}
                    className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                    Clear filters
                </button>
            )}
        </div>
    );
}
