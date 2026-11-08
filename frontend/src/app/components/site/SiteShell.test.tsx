// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import { SITE_CHROME_COPY } from "@/content/site/chrome";

const navigation = vi.hoisted(() => ({ pathname: "/pricing" }));

vi.mock("next/navigation", () => ({
    usePathname: () => navigation.pathname,
}));

import { SiteShell } from "./SiteShell";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("SiteShell", () => {
    it("shows the brand, the site navigation with the current page marked, and the app links", () => {
        navigation.pathname = "/pricing";
        render(
            <SiteShell>
                <main>content</main>
            </SiteShell>,
        );
        const header = screen.getByRole("banner");
        expect(within(header).getByText(brand.productName)).toBeInTheDocument();
        expect(within(header).getByRole("link", { name: new RegExp(brand.productName) })).toHaveAttribute(
            "href",
            "/",
        );

        const nav = screen.getByRole("navigation", { name: "Site" });
        const pricing = within(nav).getByRole("link", { name: "Pricing" });
        expect(pricing).toHaveAttribute("href", "/pricing");
        expect(pricing).toHaveAttribute("aria-current", "page");
        expect(within(nav).getByRole("link", { name: "Docs" })).not.toHaveAttribute("aria-current");
        expect(within(nav).getByRole("link", { name: "Security" })).toHaveAttribute(
            "href",
            "/security",
        );

        expect(within(header).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
        expect(within(header).getByRole("link", { name: "Create an account" })).toHaveAttribute(
            "href",
            "/signup",
        );
        expect(screen.getByRole("main")).toHaveTextContent("content");
    });

    it("marks a docs page as current under the Docs link", () => {
        navigation.pathname = "/docs/getting-started";
        render(<SiteShell>x</SiteShell>);
        const nav = screen.getByRole("navigation", { name: "Site" });
        expect(within(nav).getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
        expect(within(nav).getByRole("link", { name: "Pricing" })).not.toHaveAttribute("aria-current");
    });

    it("carries Source, Terms, Privacy, Security and Attributions links in the footer", () => {
        vi.stubEnv("NEXT_PUBLIC_GIT_SHA", COMMIT);
        render(<SiteShell>x</SiteShell>);
        const footer = screen.getByRole("contentinfo");
        const links = within(footer).getByRole("navigation", { name: "Legal and source" });
        expect(within(links).getByRole("link", { name: "Source" })).toHaveAttribute(
            "href",
            `${brand.sourceRepositoryUrl}/tree/${COMMIT}`,
        );
        expect(within(links).getByRole("link", { name: "Terms" })).toHaveAttribute(
            "href",
            brand.legalDocuments.terms.url,
        );
        expect(within(links).getByRole("link", { name: "Privacy" })).toHaveAttribute(
            "href",
            brand.legalDocuments.privacy.url,
        );
        expect(within(links).getByRole("link", { name: "Security" })).toHaveAttribute(
            "href",
            brand.legalDocuments.security.url,
        );
        expect(within(links).getByRole("link", { name: "Attributions" })).toHaveAttribute(
            "href",
            `${brand.sourceRepositoryUrl}/blob/${COMMIT}/CREDITS.md`,
        );
        expect(within(footer).getByText(SITE_CHROME_COPY.disclaimer)).toBeInTheDocument();
    });

    it("never shows the upstream project's name as the product", () => {
        render(<SiteShell>x</SiteShell>);
        const header = screen.getByRole("banner");
        expect(header).not.toHaveTextContent(brand.upstreamAttribution.projectName);
    });
});
