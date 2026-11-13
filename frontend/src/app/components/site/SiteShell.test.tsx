// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import { CONTACT_PATH, SITE_CHROME_COPY } from "@/content/site/chrome";

const navigation = vi.hoisted(() => ({ pathname: "/pricing" }));

vi.mock("next/navigation", () => ({
    usePathname: () => navigation.pathname,
}));

// The pricing page fetches its plans; here it has none to show.
vi.mock("@/app/lib/mikeApi", () => ({
    getPlans: vi.fn().mockResolvedValue({
        plans_enabled: false,
        billing_enabled: false,
        plans: [],
    }),
}));

import ContactPage from "@/app/(site)/contact/page";
import DocsIndexPage from "@/app/(site)/docs/page";
import PricingPage from "@/app/(site)/pricing/page";
import SecurityPage from "@/app/(site)/security/page";
import { PRICING_COPY } from "@/content/site/pricing";
import { HomeContent } from "./HomeContent";
import { PAGES_WITH_OWN_ACTION } from "./SiteNav";
import { SITE_CONTENT_ID, SiteShell } from "./SiteShell";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const PRIMARY = '[data-slot="primary-action"]';

const classesOf = (element: Element) => (element.getAttribute("class") ?? "").split(/\s+/);

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

    it("marks the current page with an underline as well as a colour", () => {
        navigation.pathname = "/security";
        render(<SiteShell>x</SiteShell>);
        const nav = screen.getByRole("navigation", { name: "Site" });
        expect(classesOf(within(nav).getByRole("link", { name: "Security" }))).toContain("underline");
        expect(classesOf(within(nav).getByRole("link", { name: "Pricing" }))).not.toContain(
            "underline",
        );
    });

    it("links the footer to Contact, Security, Terms, Privacy, Source and Attributions, in that order", () => {
        vi.stubEnv("NEXT_PUBLIC_GIT_SHA", COMMIT);
        render(<SiteShell>x</SiteShell>);
        const footer = screen.getByRole("contentinfo");
        const links = within(footer).getByRole("navigation", {
            name: SITE_CHROME_COPY.footerNavLabel,
        });
        expect(
            within(links)
                .getAllByRole("link")
                .map((link) => link.textContent),
        ).toEqual(["Contact", "Security", "Terms", "Privacy", "Source", "Attributions"]);
        expect(within(links).getByRole("link", { name: "Contact" })).toHaveAttribute(
            "href",
            CONTACT_PATH,
        );
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

    it("starts with a link past the header to the page's content", async () => {
        navigation.pathname = "/docs";
        const { container } = render(
            <SiteShell>
                <main>content</main>
            </SiteShell>,
        );
        const skip = screen.getByRole("link", { name: SITE_CHROME_COPY.skipToContent });
        // The first thing the keyboard reaches.
        await userEvent.tab();
        expect(skip).toHaveFocus();
        expect(container.querySelector("a")).toBe(skip);
        // Out of sight until then, and in view once it has focus.
        expect(classesOf(skip)).toContain("sr-only");
        expect(classesOf(skip)).toContain("focus:not-sr-only");

        expect(skip).toHaveAttribute("href", `#${SITE_CONTENT_ID}`);
        const target = container.querySelector(`#${SITE_CONTENT_ID}`) as HTMLElement;
        expect(target).not.toBeNull();
        // Focusable from the link, and it holds the page, not the header.
        expect(target).toHaveAttribute("tabindex", "-1");
        expect(target).toContainElement(screen.getByRole("main"));
        expect(target).not.toContainElement(screen.getByRole("banner"));
    });

    it("makes every link of the header and the footer 44px tall", () => {
        navigation.pathname = "/docs";
        render(<SiteShell>x</SiteShell>);
        const links = [
            ...within(screen.getByRole("banner")).getAllByRole("link"),
            ...within(screen.getByRole("contentinfo")).getAllByRole("link"),
        ];
        expect(links.length).toBeGreaterThan(8);
        for (const link of links) {
            const classes = classesOf(link);
            expect(
                classes.includes("min-h-11") || classes.includes("h-11"),
                `${link.textContent} is a 44px target`,
            ).toBe(true);
        }
    });

    it("adds no menu button: the header is links only", () => {
        render(<SiteShell>x</SiteShell>);
        expect(within(screen.getByRole("banner")).queryByRole("button")).toBeNull();
    });
});

describe("one filled action on every public page", () => {
    /** The header's account link, and whether it is the filled one. */
    function headerAccountLink() {
        const link = within(screen.getByRole("banner")).getByRole("link", {
            name: SITE_CHROME_COPY.createAccount,
        });
        return { link, filled: link.matches(PRIMARY) };
    }

    const OWN_ACTION: Record<string, () => ReactElement> = {
        "/": () => <HomeContent />,
        "/pricing": () => <PricingPage />,
        [CONTACT_PATH]: () => <ContactPage />,
    };

    it("knows which pages carry their own", () => {
        expect([...PAGES_WITH_OWN_ACTION].sort()).toEqual(Object.keys(OWN_ACTION).sort());
    });

    it.each(Object.keys(OWN_ACTION))(
        "%s carries the filled action itself, and the header's steps down to an outline",
        async (pathname) => {
            navigation.pathname = pathname;
            const { container } = render(<SiteShell>{OWN_ACTION[pathname]()}</SiteShell>);
            if (pathname === "/pricing") await screen.findByText(PRICING_COPY.unavailable);

            const primary = container.querySelectorAll(PRIMARY);
            expect(primary).toHaveLength(1);
            expect(screen.getByRole("main")).toContainElement(primary[0] as HTMLElement);

            const account = headerAccountLink();
            expect(account.filled).toBe(false);
            // Same size as the filled one, so nothing moves between pages.
            expect(classesOf(account.link)).toContain("h-11");
            expect(classesOf(account.link)).toContain("liquid-glass-flat");
        },
    );

    it.each([
        ["/docs", () => <DocsIndexPage />],
        ["/security", () => <SecurityPage />],
        ["/docs/getting-started", () => <main>A documentation page</main>],
    ] as const)("%s has the header's account link as its one filled action", (pathname, page) => {
        navigation.pathname = pathname;
        const { container } = render(<SiteShell>{page()}</SiteShell>);
        const primary = container.querySelectorAll(PRIMARY);
        expect(primary).toHaveLength(1);
        const account = headerAccountLink();
        expect(account.filled).toBe(true);
        expect(primary[0]).toBe(account.link);
        expect(classesOf(account.link)).toContain("h-11");
        expect(account.link).toHaveAttribute("href", "/signup");
    });
});
