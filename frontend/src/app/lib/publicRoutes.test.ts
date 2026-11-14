// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACT_PATH } from "@/content/site/chrome";
import { PUBLIC_ROUTE_PREFIXES, isPublicRoute } from "./publicRoutes";

// The two gates that stand in front of every page, with a signed-in user who
// has not finished onboarding and who owes a second factor: the worst case
// for a public page, which must render all the same.
const gates = vi.hoisted(() => ({
    pathname: "/contact",
    replace: vi.fn(),
    needsMfaVerification: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    usePathname: () => gates.pathname,
    useRouter: () => ({ replace: gates.replace }),
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: { displayName: "Alex", onboardingComplete: false, mfaOnLogin: true },
        loading: false,
    }),
}));

vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
    needsMfaVerification: () => gates.needsMfaVerification(),
}));

vi.mock("@/app/components/shared/FullScreenLoader", () => ({
    FullScreenLoader: () => createElement("div", null, "Loading"),
}));

import { OnboardingGate } from "@/app/components/auth/OnboardingGate";
import { MfaLoginGate } from "@/app/components/shared/MfaLoginGate";

/** A page under `prefix`. */
function samplePublicPath(prefix: string): string {
    return prefix.endsWith("/") ? `${prefix}example` : prefix;
}

/** A page inside both gates, the way the app's providers nest them. */
function renderBehindTheGates(pathname: string) {
    gates.pathname = pathname;
    return render(
        createElement(
            MfaLoginGate,
            null,
            createElement(OnboardingGate, null, createElement("div", null, "The page")),
        ),
    );
}

describe("isPublicRoute", () => {
    it("lists the public prefixes later pages are added under", () => {
        expect([...PUBLIC_ROUTE_PREFIXES]).toEqual([
            "/source",
            "/legal/",
            "/security",
            "/.well-known/",
            "/request/",
            "/docs",
            "/pricing",
            "/contact",
        ]);
    });

    it.each(PUBLIC_ROUTE_PREFIXES.map((prefix) => [prefix]))(
        "treats pages under %s as public",
        (prefix) => {
            expect(isPublicRoute(samplePublicPath(prefix))).toBe(true);
            expect(isPublicRoute(`${prefix.replace(/\/$/, "")}/deeper/page`)).toBe(
                true,
            );
        },
    );

    it.each([
        "/sourcery",
        "/documents",
        "/docsx",
        "/legal",
        "/request",
        "/securityx",
        "/contacts",
        "/contact-us",
        "/projects",
        "/assistant/chat/chat-1",
        "/",
        "",
        null,
        undefined,
    ])("keeps %s behind the gates", (pathname) => {
        expect(isPublicRoute(pathname)).toBe(false);
    });

    it("lists the contact page under the path the site links to", () => {
        expect(CONTACT_PATH).toBe("/contact");
        expect(PUBLIC_ROUTE_PREFIXES).toContain(CONTACT_PATH);
        expect(isPublicRoute(CONTACT_PATH)).toBe(true);
    });
});

describe("the onboarding and MFA gates", () => {
    beforeEach(() => {
        gates.replace.mockReset();
        gates.needsMfaVerification.mockReset();
        gates.needsMfaVerification.mockResolvedValue(true);
        window.sessionStorage.clear();
    });

    it("render the contact page without redirecting, even for an unfinished account", async () => {
        renderBehindTheGates(CONTACT_PATH);
        expect(screen.getByText("The page")).toBeInTheDocument();
        // The second-factor check still settles to "required"...
        await waitFor(() => expect(gates.needsMfaVerification).toHaveBeenCalled());
        // ...and neither gate sends anyone away or covers the page.
        await waitFor(() => expect(gates.replace).not.toHaveBeenCalled());
        expect(screen.getByText("The page")).toBeInTheDocument();
        expect(screen.queryByText("Loading")).toBeNull();
    });

    it.each(PUBLIC_ROUTE_PREFIXES.map((prefix) => [samplePublicPath(prefix)]))(
        "render the public page %s without redirecting",
        async (pathname) => {
            renderBehindTheGates(pathname);
            expect(screen.getByText("The page")).toBeInTheDocument();
            await waitFor(() => expect(gates.needsMfaVerification).toHaveBeenCalled());
            await waitFor(() => expect(gates.replace).not.toHaveBeenCalled());
            expect(screen.queryByText("Loading")).toBeNull();
        },
    );

    it("still stop the same account at a page of the app, so the check above means something", async () => {
        renderBehindTheGates("/projects");
        expect(screen.queryByText("The page")).toBeNull();
        await waitFor(() => expect(gates.replace).toHaveBeenCalled());
    });
});
