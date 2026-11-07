// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RequestDeskRequest } from "@/app/lib/mikeApi";
import { IntakeRequestsTable } from "./IntakeRequestsTable";

function makeRequest(overrides: Partial<RequestDeskRequest> = {}): RequestDeskRequest {
    return {
        id: "req-1",
        org_id: "org-1",
        reference: "REQ-1",
        reference_number: 1,
        title: "Acme distribution agreement",
        details: "Please review the draft.",
        request_type: "Contract review",
        status: "new",
        priority: "normal",
        source: "internal",
        requester_name: "Dana Client",
        requester_email: "dana@example.com",
        assignee: null,
        created_by: {
            user_id: "u1",
            email: "alex@example.com",
            display_name: "Alex Lawyer",
            is_member: true,
        },
        matter: null,
        sla_due_at: null,
        is_overdue: false,
        closed_at: null,
        created_at: "2026-11-01T10:00:00.000Z",
        updated_at: "2026-11-01T10:00:00.000Z",
        access_role: "owner",
        ...overrides,
    };
}

const baseProps = {
    loading: false,
    error: false,
    hasActiveFilters: false,
    selectedRequestId: null,
    sort: null,
    onSortChange: vi.fn(),
    onOpenRequest: vi.fn(),
    onRetry: vi.fn(),
    onClearFilters: vi.fn(),
    onNewRequest: vi.fn(),
    canCreate: true,
};

function groupHeadings(container: HTMLElement): string[] {
    return Array.from(
        container.querySelectorAll('[data-slot="intake-group-heading"]'),
    ).map((node) => node.textContent ?? "");
}

describe("IntakeRequestsTable", () => {
    it("renders requests grouped by status in board order", () => {
        const requests = [
            makeRequest({ id: "a", title: "New one", status: "new" }),
            makeRequest({ id: "b", title: "Working one", status: "in_progress" }),
            makeRequest({ id: "c", title: "Done one", status: "closed" }),
        ];
        const { container } = render(
            <IntakeRequestsTable {...baseProps} requests={requests} />,
        );

        const headings = groupHeadings(container);
        expect(headings.some((h) => h.startsWith("New"))).toBe(true);
        expect(headings.some((h) => h.startsWith("In progress"))).toBe(true);
        expect(headings.some((h) => h.startsWith("Closed"))).toBe(true);
        // Open statuses are grouped before terminal ones.
        const newIndex = headings.findIndex((h) => h.startsWith("New"));
        const closedIndex = headings.findIndex((h) => h.startsWith("Closed"));
        expect(newIndex).toBeLessThan(closedIndex);

        expect(screen.getByRole("button", { name: "New one" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Working one" })).toBeVisible();
    });

    it("opens a request when its row title is activated", () => {
        const request = makeRequest({ id: "a", title: "Open me" });
        const onOpenRequest = vi.fn();
        render(
            <IntakeRequestsTable
                {...baseProps}
                requests={[request]}
                onOpenRequest={onOpenRequest}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Open me" }));
        expect(onOpenRequest).toHaveBeenCalledWith(request);
    });

    it("renders a skeleton whose columns match the table while loading", () => {
        const { container } = render(
            <IntakeRequestsTable {...baseProps} loading requests={[]} />,
        );
        // Every column header is present so the skeleton lines up with real rows.
        expect(screen.getByText("Request")).toBeVisible();
        expect(screen.getByText("Priority")).toBeVisible();
        expect(screen.getByText("Assignee")).toBeVisible();
        expect(screen.getByText("Due date")).toBeVisible();
        expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
            0,
        );
        // No data states leak through while loading.
        expect(screen.queryByText("No matching requests")).not.toBeInTheDocument();
    });

    it("shows an error state with Try again on a load failure", () => {
        const onRetry = vi.fn();
        render(
            <IntakeRequestsTable
                {...baseProps}
                error
                requests={[]}
                onRetry={onRetry}
            />,
        );
        expect(screen.getByText("Unable to load requests")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("shows a filtered-empty state with Clear filters", () => {
        const onClearFilters = vi.fn();
        render(
            <IntakeRequestsTable
                {...baseProps}
                hasActiveFilters
                requests={[]}
                onClearFilters={onClearFilters}
            />,
        );
        expect(screen.getByText("No matching requests")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(onClearFilters).toHaveBeenCalledTimes(1);
    });

    it("shows the first-run empty state with New request when nothing is filtered", () => {
        const onNewRequest = vi.fn();
        render(
            <IntakeRequestsTable
                {...baseProps}
                requests={[]}
                onNewRequest={onNewRequest}
            />,
        );
        expect(screen.getByText("No requests yet")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "New request" }));
        expect(onNewRequest).toHaveBeenCalledTimes(1);
    });

    it("marks an overdue request's due date in words, not colour alone", () => {
        const requests = [
            makeRequest({
                id: "a",
                title: "Late one",
                sla_due_at: "2026-01-01T00:00:00.000Z",
                is_overdue: true,
            }),
        ];
        render(<IntakeRequestsTable {...baseProps} requests={requests} />);
        const row = screen
            .getByRole("button", { name: "Late one" })
            .closest(".group") as HTMLElement;
        expect(within(row).getByText(/Overdue/)).toBeVisible();
    });
});
