// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MikeLayout from "./layout";

const navigation = vi.hoisted(() => ({
    pathname: "/projects/project-1",
    push: vi.fn(),
    replace: vi.fn(),
}));
const auth = vi.hoisted(() => ({ signedOutOnPurpose: false }));

vi.mock("next/navigation", () => ({
    usePathname: () => navigation.pathname,
    useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: false,
        authLoading: false,
        signedOutOnPurpose: auth.signedOutOnPurpose,
    }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    ChatHistoryProvider: ({ children }: { children: React.ReactNode }) =>
        children,
}));
vi.mock("@/app/components/shared/AppSidebar", () => ({
    AppSidebar: () => null,
}));

describe("signed-out visit to an app page", () => {
    beforeEach(() => {
        navigation.push.mockReset();
        navigation.replace.mockReset();
        auth.signedOutOnPurpose = false;
    });

    // A link opened signed out, and a session that expired, look the same
    // here: both keep the page as next.
    it("sends the visitor to login with the page they asked for as next", async () => {
        navigation.pathname = "/projects/project-1";
        window.history.replaceState(null, "", "/projects/project-1?tab=chats");

        render(
            <MikeLayout>
                <p>Project</p>
            </MikeLayout>,
        );

        await waitFor(() =>
            expect(navigation.replace).toHaveBeenCalledWith(
                `/login?next=${encodeURIComponent("/projects/project-1?tab=chats")}`,
            ),
        );
        expect(navigation.push).not.toHaveBeenCalled();
        expect(screen.queryByText("Project")).not.toBeInTheDocument();
    });

    it("needs no next for the default page", async () => {
        navigation.pathname = "/assistant";
        window.history.replaceState(null, "", "/assistant");

        render(
            <MikeLayout>
                <p>Assistant</p>
            </MikeLayout>,
        );

        await waitFor(() =>
            expect(navigation.replace).toHaveBeenCalledWith("/login"),
        );
    });

    // Whoever signs in next on this tab, perhaps someone else on a shared
    // machine, starts from the default page, not the one left behind.
    it("sends someone who signed out on purpose to a plain login page", async () => {
        auth.signedOutOnPurpose = true;
        navigation.pathname = "/projects/project-1";
        window.history.replaceState(null, "", "/projects/project-1?tab=chats");

        render(
            <MikeLayout>
                <p>Project</p>
            </MikeLayout>,
        );

        await waitFor(() =>
            expect(navigation.replace).toHaveBeenCalledWith("/login"),
        );
        expect(navigation.replace).not.toHaveBeenCalledWith(
            expect.stringContaining("next="),
        );
    });
});
