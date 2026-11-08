// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_COPY } from "@/content/site/home";

const navigation = vi.hoisted(() => ({
    redirect: vi.fn((url: string) => {
        throw new Error(`REDIRECT:${url}`);
    }),
}));

const headers = vi.hoisted(() => ({
    cookieNames: [] as string[],
}));

vi.mock("next/navigation", () => ({
    redirect: navigation.redirect,
    usePathname: () => "/",
}));

vi.mock("next/headers", () => ({
    cookies: async () => ({
        getAll: () => headers.cookieNames.map((name) => ({ name, value: "x" })),
    }),
}));

import RootPage from "./page";

beforeEach(() => {
    headers.cookieNames = [];
    navigation.redirect.mockClear();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("/ (root page)", () => {
    it("keeps redirecting to the app while NEXT_PUBLIC_SITE_ENABLED is unset", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "");
        await expect(RootPage()).rejects.toThrow("REDIRECT:/assistant");
        expect(navigation.redirect).toHaveBeenCalledWith("/assistant");
    });

    it("shows the home page to a signed-out visitor when the site is enabled", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "true");
        render(await RootPage());
        const main = within(screen.getByRole("main"));
        expect(
            main.getByRole("heading", { level: 1, name: HOME_COPY.headline }),
        ).toBeInTheDocument();
        // The header offers the same two links; the home content has its own.
        expect(main.getByRole("link", { name: HOME_COPY.primaryAction })).toHaveAttribute(
            "href",
            "/signup",
        );
        expect(main.getByRole("link", { name: HOME_COPY.secondaryAction })).toHaveAttribute(
            "href",
            "/login",
        );
        // The frame is there: site navigation and the footer with its links.
        expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
        expect(screen.getByRole("contentinfo")).toBeInTheDocument();
        expect(navigation.redirect).not.toHaveBeenCalled();
    });

    it("sends a signed-in browser to the app even when the site is enabled", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "true");
        headers.cookieNames = ["theme", "__Host-mike-session"];
        await expect(RootPage()).rejects.toThrow("REDIRECT:/assistant");
    });

    it("treats a chunked session cookie as signed in", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "true");
        headers.cookieNames = ["mike-session.1"];
        await expect(RootPage()).rejects.toThrow("REDIRECT:/assistant");
    });

    it("shows the home page to a visitor who started a provider sign-in and backed out", async () => {
        // The PKCE verifier (`mike-session-code-verifier`) is set as soon as
        // the provider button is clicked and outlives an abandoned sign-in by
        // months. It is not a session, so it must not hide the home page.
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "true");
        headers.cookieNames = ["theme", "mike-session-code-verifier"];
        render(await RootPage());
        expect(
            screen.getByRole("heading", { level: 1, name: HOME_COPY.headline }),
        ).toBeInTheDocument();
        expect(navigation.redirect).not.toHaveBeenCalled();
    });
});
