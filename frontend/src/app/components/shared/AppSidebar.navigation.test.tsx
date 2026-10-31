// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listProjectsPage } from "@/app/lib/mikeApi";
import { AppSidebar } from "./AppSidebar";
import { NAV_ITEMS } from "./navItems";

const state = vi.hoisted(() => ({
    pathname: "/assistant",
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: state.push }),
    usePathname: () => state.pathname,
}));

vi.mock("next/image", () => ({
    default: ({ className }: { className?: string }) => (
        <span aria-hidden="true" className={className} />
    ),
}));

vi.mock("@/app/lib/mikeApi", () => ({
    listProjectsPage: vi.fn(),
    listProjectChats: vi.fn(async () => []),
    listTabularReviews: vi.fn(async () => []),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "navigation-user", email: "alice@example.com" },
        signOut: vi.fn(),
    }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { displayName: "Alice", tier: "Free" } }),
}));

vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({
        chats: [],
        loadingMoreChats: false,
        loadMoreChats: vi.fn(),
        setCurrentChatId: vi.fn(),
    }),
}));

vi.mock("@/shared/ui/MikeIconUI", () => ({
    MikeIcon: () => <span aria-hidden="true" />,
}));

const primaryNavigation = () =>
    screen.getByRole("navigation", { name: "Primary" });

beforeEach(() => {
    vi.clearAllMocks();
    state.pathname = "/assistant";
    vi.mocked(listProjectsPage).mockResolvedValue([]);
});

describe("AppSidebar navigation", () => {
    it("renders every destination as a link with its address inside a nav landmark", () => {
        render(<AppSidebar isOpen onToggle={vi.fn()} />);

        const links = within(primaryNavigation()).getAllByRole("link");
        expect(
            links.map((link) => [
                link.textContent,
                link.getAttribute("href"),
            ]),
        ).toEqual(NAV_ITEMS.map((item) => [item.label, item.href]));
        expect(within(primaryNavigation()).getAllByRole("listitem")).toHaveLength(
            NAV_ITEMS.length,
        );
        // Links navigate by themselves; the sidebar no longer pushes a route.
        expect(
            within(primaryNavigation()).queryByRole("button"),
        ).not.toBeInTheDocument();
    });

    it.each([
        ["/assistant", "Assistant"],
        ["/projects", "Projects"],
        ["/library", "Library"],
        ["/tabular-reviews/review-1", "Tabular Review"],
        ["/workflows/assistant/workflow-1", "Workflows"],
        ["/playbooks", "Playbooks"],
    ])("marks only the current page with aria-current on %s", (pathname, label) => {
        state.pathname = pathname;
        render(<AppSidebar isOpen onToggle={vi.fn()} />);

        const nav = within(primaryNavigation());
        expect(nav.getByRole("link", { name: label })).toHaveAttribute(
            "aria-current",
            "page",
        );
        expect(
            nav
                .getAllByRole("link")
                .filter((link) => link.hasAttribute("aria-current")),
        ).toHaveLength(1);
    });

    it.each(["/assistant/chat/chat-1", "/projects/project-1"])(
        "leaves Assistant and Projects unmarked below their own page (%s)",
        (pathname) => {
            state.pathname = pathname;
            render(<AppSidebar isOpen onToggle={vi.fn()} />);

            for (const link of within(primaryNavigation()).getAllByRole("link")) {
                expect(link).not.toHaveAttribute("aria-current");
            }
        },
    );

    it("names the icon-only links of the collapsed sidebar", () => {
        state.pathname = "/workflows";
        render(<AppSidebar isOpen={false} onToggle={vi.fn()} />);

        const workflows = within(primaryNavigation()).getByRole("link", {
            name: "Workflows",
        });
        expect(workflows).toHaveAttribute("href", "/workflows");
        expect(workflows).toHaveAttribute("aria-current", "page");
        expect(workflows).toHaveAttribute("title", "Workflows");
    });

    it("exposes the Recent Projects toggle's state with aria-expanded", async () => {
        const user = userEvent.setup();
        render(<AppSidebar isOpen onToggle={vi.fn()} />);

        const toggle = screen.getByRole("button", { name: "Recent Projects" });
        expect(toggle).toHaveAttribute("type", "button");
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        const list = screen.getByRole("region", { name: "Recent Projects" });
        expect(toggle).toHaveAttribute("aria-controls", list.id);
        expect(await within(list).findByText("No projects yet")).toBeVisible();

        await user.click(toggle);

        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(toggle).not.toHaveAttribute("aria-controls");
        expect(
            screen.queryByRole("region", { name: "Recent Projects" }),
        ).not.toBeInTheDocument();

        await user.click(toggle);

        expect(toggle).toHaveAttribute("aria-expanded", "true");
    });
});
