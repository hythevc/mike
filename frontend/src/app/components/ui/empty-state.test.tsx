import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
    it("renders the title", () => {
        render(<EmptyState title="Workflows" />);
        expect(screen.getByText("Workflows")).toBeInTheDocument();
    });

    it("renders the description when provided", () => {
        render(<EmptyState title="Workflows" description="Nothing here yet." />);
        expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    });

    it("omits the description paragraph when not provided", () => {
        const { container } = render(<EmptyState title="Workflows" />);
        expect(
            container.querySelector('[data-slot="empty-state-description"]'),
        ).toBeNull();
    });

    it("applies the shared display heading classes through HeadingUI", () => {
        render(<EmptyState title="Workflows" />);
        // The display size from HeadingUI, in the fg colour role (no raw gray).
        expect(screen.getByText("Workflows")).toHaveClass(
            "font-serif",
            "text-2xl",
            "font-medium",
            "text-fg",
        );
    });

    it("uses the error tone for the description when requested", () => {
        render(
            <EmptyState title="Projects" description="Boom" tone="error" />,
        );
        expect(screen.getByText("Boom")).toHaveClass("text-danger");
    });

    it("uses the muted tone for the description by default", () => {
        render(<EmptyState title="Projects" description="Add one" />);
        // The semantic muted token (>= 4.5:1), not the sub-AA text-gray-400.
        expect(screen.getByText("Add one")).toHaveClass("text-fg-muted");
    });

    it("renders the icon and the action slots", () => {
        const { container } = render(
            <EmptyState
                icon={<svg data-testid="empty-icon" />}
                title="Projects"
                action={<button type="button">Create</button>}
            />,
        );

        expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Create" }),
        ).toBeInTheDocument();
        expect(
            container.querySelector('[data-slot="empty-state-icon"]'),
        ).toHaveClass("mb-4");
    });

    it("sizes image icons as well as SVG icons", () => {
        const { container } = render(
            <EmptyState
                icon={createElement("img", {
                    src: "/icons/features/library.svg",
                    alt: "",
                })}
                title="Files"
            />,
        );

        const icon = container.querySelector('[data-slot="empty-state-icon"]');
        expect(icon?.className).toContain("[&>*]:h-8");
        expect(icon?.className).toContain("[&>*]:w-8");
    });

    it("merges a caller className onto the root", () => {
        const { container } = render(
            <EmptyState title="Projects" className="max-w-sm" />,
        );
        expect(
            container.querySelector('[data-slot="empty-state"]'),
        ).toHaveClass("max-w-sm");
    });
});
