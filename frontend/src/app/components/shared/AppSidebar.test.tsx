import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listProjectsPage } from "@/app/lib/mikeApi";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import { AppSidebar } from "./AppSidebar";

const { signOut, flushPendingChatDeletes, push } = vi.hoisted(() => ({
    signOut: vi.fn(),
    flushPendingChatDeletes: vi.fn(),
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push }),
    usePathname: () => "/assistant",
}));

vi.mock("next/image", () => ({
    default: () => <span aria-hidden="true" />,
}));

vi.mock("@/app/lib/mikeApi", () => ({
    listProjectsPage: vi.fn(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "sidebar-user", email: "alice@example.com" },
        signOut,
    }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: { displayName: "Alice", tier: "Free" },
    }),
}));

vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({
        chats: [],
        loadingMoreChats: false,
        loadMoreChats: vi.fn(),
        setCurrentChatId: vi.fn(),
        flushPendingChatDeletes,
    }),
}));

vi.mock("@/app/components/chat/mike-icon", () => ({
    MikeIcon: () => <span aria-hidden="true" />,
}));

function renderSidebar() {
    return render(
        <>
            <AppSidebar isOpen onToggle={vi.fn()} />
            <ToastViewportUI />
        </>,
    );
}

describe("AppSidebar failures", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearToasts();
        vi.mocked(listProjectsPage).mockResolvedValue([]);
        signOut.mockResolvedValue(undefined);
        flushPendingChatDeletes.mockResolvedValue({ refused: 0 });
    });

    afterEach(() => {
        clearToasts();
    });

    // The old catch emptied the section, so a failed request looked exactly
    // like an account with no projects.
    it("tells the user when recent projects cannot be loaded", async () => {
        vi.mocked(listProjectsPage).mockRejectedValue(new Error("boom"));

        renderSidebar();

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Couldn't load your recent projects",
            ),
        );
    });

    it("retries the recent projects load from the toast", async () => {
        const user = userEvent.setup();
        vi.mocked(listProjectsPage).mockRejectedValueOnce(
            new Error("boom"),
        );

        renderSidebar();

        await waitFor(() => screen.getByRole("alert"));
        await user.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(listProjectsPage).toHaveBeenCalledTimes(2),
        );
    });

    // A failed sign-out leaves the session live; signing out again is safe,
    // so the notice offers Retry rather than only "try again".
    it("reports a failed sign-out with a Retry", async () => {
        const user = userEvent.setup();
        signOut.mockRejectedValue(new TypeError("Failed to fetch"));

        renderSidebar();

        await user.click(screen.getByText("Alice").closest("button")!);
        await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Couldn't sign out",
            ),
        );
        expect(
            screen.getByRole("button", { name: "Retry" }),
        ).toBeInTheDocument();
    });

    // Once the session ends, a delete still waiting on Undo can no longer
    // be sent; the person confirmed it, so it goes before sign-out does.
    // (The context bounds that wait; see ChatHistoryContext.undoDelete.)
    it("sends chat deletes still waiting on Undo before signing out, and says it is signing out", async () => {
        const user = userEvent.setup();
        let finishDeletes!: (flushed: { refused: number }) => void;
        flushPendingChatDeletes.mockReturnValue(
            new Promise<{ refused: number }>((resolve) => {
                finishDeletes = resolve;
            }),
        );

        renderSidebar();
        await user.click(screen.getByText("Alice").closest("button")!);
        await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

        expect(flushPendingChatDeletes).toHaveBeenCalledExactlyOnceWith({
            report: false,
        });
        expect(signOut).not.toHaveBeenCalled();
        expect(screen.getByRole("status")).toHaveTextContent("Signing out…");
        finishDeletes({ refused: 0 });
        await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
        await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    // Signing out discards the session's notices, including the one that
    // named the refused chat; this one names none.
    it.each([
        [1, "Couldn't delete the chat", "A chat you deleted was not deleted and is still in your history."],
        [2, "Couldn't delete the chats", "2 chats you deleted were not deleted and are still in your history."],
    ])(
        "says when %i delete(s) sent while signing out were refused",
        async (refused, title, message) => {
            const user = userEvent.setup();
            flushPendingChatDeletes.mockResolvedValue({ refused });

            renderSidebar();
            await user.click(screen.getByText("Alice").closest("button")!);
            await user.click(
                screen.getByRole("menuitem", { name: "Sign out" }),
            );

            await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
            expect(signOut).toHaveBeenCalledOnce();
            const notice = screen.getByRole("alert");
            expect(notice).toHaveTextContent(title);
            expect(notice).toHaveTextContent(message);
        },
    );

    it("still says a delete was refused when signing out itself fails", async () => {
        const user = userEvent.setup();
        flushPendingChatDeletes.mockResolvedValue({ refused: 1 });
        signOut.mockRejectedValue(new TypeError("Failed to fetch"));

        renderSidebar();
        await user.click(screen.getByText("Alice").closest("button")!);
        await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

        await waitFor(() =>
            expect(screen.getAllByRole("alert")).toHaveLength(2),
        );
        const [failure, refusal] = screen.getAllByRole("alert");
        expect(failure).toHaveTextContent("Couldn't sign out");
        expect(refusal).toHaveTextContent("Couldn't delete the chat");
        expect(push).not.toHaveBeenCalled();
    });
});
