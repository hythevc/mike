// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_ROUTE_PREFIXES } from "@/app/lib/publicRoutes";
import { MfaLoginGate } from "./MfaLoginGate";

const state = vi.hoisted(() => ({
    pathname: "/projects",
    searchParams: new URLSearchParams(),
    replace: vi.fn(),
    needsMfaVerification: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    usePathname: () => state.pathname,
    useRouter: () => ({ replace: state.replace }),
    useSearchParams: () => state.searchParams,
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: { mfaOnLogin: true },
        loading: false,
    }),
}));

vi.mock("../popups/MfaVerificationPopup", () => ({
    needsMfaVerification: () => state.needsMfaVerification(),
}));

vi.mock("@/app/components/shared/FullScreenLoader", () => ({
    FullScreenLoader: () => <div>Loading</div>,
}));

function renderGate() {
    return render(
        <MfaLoginGate>
            <div>Page content</div>
        </MfaLoginGate>,
    );
}

describe("MfaLoginGate with verification required", () => {
    beforeEach(() => {
        state.pathname = "/projects";
        state.searchParams = new URLSearchParams();
        state.replace.mockReset();
        state.needsMfaVerification.mockReset();
        state.needsMfaVerification.mockResolvedValue(true);
        window.sessionStorage.clear();
    });

    it.each(
        PUBLIC_ROUTE_PREFIXES.map((prefix) => [
            prefix.endsWith("/") ? `${prefix}example` : prefix,
        ]),
    )("renders the public page %s without asking for a second factor", async (path) => {
        state.pathname = path;
        renderGate();

        expect(screen.getByText("Page content")).toBeInTheDocument();
        // The assurance check still settles to "required"...
        await waitFor(() =>
            expect(state.needsMfaVerification).toHaveBeenCalled(),
        );
        // ...without that sending anyone to the verification page.
        await waitFor(() => expect(state.replace).not.toHaveBeenCalled());
        expect(screen.getByText("Page content")).toBeInTheDocument();
    });

    it("still sends other routes to verification, keeping the page as next", async () => {
        state.pathname = "/projects/project-1";
        state.searchParams = new URLSearchParams("tab=chats");
        renderGate();

        expect(screen.queryByText("Page content")).not.toBeInTheDocument();
        await waitFor(() =>
            expect(state.replace).toHaveBeenCalledWith(
                `/verify-mfa?next=${encodeURIComponent("/projects/project-1?tab=chats")}`,
            ),
        );
    });
});

describe("MfaLoginGate once verified on the verification page", () => {
    beforeEach(() => {
        state.pathname = "/verify-mfa";
        state.replace.mockReset();
        state.needsMfaVerification.mockReset();
        state.needsMfaVerification.mockResolvedValue(false);
        window.sessionStorage.clear();
    });

    it.each([
        ["/projects/project-1?tab=chats", "/projects/project-1?tab=chats"],
        // A browser reads "/\\host" as "//host": another site.
        ["/\\evil.example", "/assistant"],
        ["//evil.example/projects", "/assistant"],
        ["https://evil.example/assistant", "/assistant"],
        ["/verify-mfa?next=/projects", "/assistant"],
    ])("returns to next=%s as %s", async (next, destination) => {
        state.searchParams = new URLSearchParams({ next });
        renderGate();

        await waitFor(() =>
            expect(state.replace).toHaveBeenCalledWith(destination),
        );
    });
});
