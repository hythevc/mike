// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTACT_COPY, contactMailto } from "@/content/site/contact";
import { brand } from "@/shared/brand.generated";
import ContactPage, { generateMetadata } from "./page";

const PRIMARY = '[data-slot="primary-action"]';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("/contact", () => {
    it("has one primary action: an email to the brand's support mailbox, subject filled in", () => {
        const { container } = render(<ContactPage />);
        expect(
            screen.getByRole("heading", { level: 1, name: CONTACT_COPY.title }),
        ).toBeInTheDocument();
        expect(screen.getByText(CONTACT_COPY.lede)).toBeInTheDocument();

        const primary = container.querySelectorAll(PRIMARY);
        expect(primary).toHaveLength(1);
        const action = screen.getByRole("link", { name: CONTACT_COPY.action });
        expect(primary[0]).toBe(action);

        const href = action.getAttribute("href")!;
        expect(href).toBe(contactMailto());
        expect(href.startsWith(`mailto:${brand.supportEmail}?subject=`)).toBe(true);
        expect(decodeURIComponent(href.split("?subject=")[1])).toBe(CONTACT_COPY.subject);
        // 44px tall, and the only mail link on the page.
        expect(action.className.split(/\s+/)).toContain("h-11");
        expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(1);
    });

    it("shows the address in plain text, for a browser that opens no mail program", () => {
        const { container } = render(<ContactPage />);
        const address = container.querySelector('[data-slot="contact-address"]') as HTMLElement;
        expect(address).toHaveTextContent(brand.supportEmail);
        // Plain text, not a second action, and it wraps instead of clipping.
        expect(address.closest("a")).toBeNull();
        expect(address.className).toContain("[overflow-wrap:anywhere]");
        expect(address.className).not.toMatch(/\btruncate\b|\boverflow-hidden\b/);
    });

    it("is not a form: nothing to fill in, nothing to schedule", () => {
        const { container } = render(<ContactPage />);
        expect(container.querySelector("form, input, textarea, select, button, iframe")).toBeNull();
    });

    it("promises no reply time unless the operator states one", () => {
        const { container } = render(<ContactPage />);
        expect(CONTACT_COPY.responseNote).toBeNull();
        expect(container.querySelector('[data-slot="contact-response-note"]')).toBeNull();
        const main = screen.getByRole("main");
        expect(main.textContent).not.toMatch(
            /\b(?:within|hours?|business days?|working days?|same day|promptly|shortly|demo)\b/i,
        );
    });

    it("says what to include and what to leave out", () => {
        render(<ContactPage />);
        const section = screen.getByRole("region", { name: CONTACT_COPY.includeHeading });
        const items = within(section).getAllByRole("listitem");
        expect(items.map((item) => item.textContent)).toEqual([...CONTACT_COPY.include]);
        expect(within(section).getByText(CONTACT_COPY.leaveOut)).toBeInTheDocument();
    });

    it("links to Security and Pricing, and gives a way back", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "true");
        render(<ContactPage />);
        const section = screen.getByRole("region", { name: CONTACT_COPY.pointersHeading });
        expect(within(section).getByRole("link", { name: "Security" })).toHaveAttribute(
            "href",
            "/security",
        );
        expect(within(section).getByRole("link", { name: "Pricing" })).toHaveAttribute(
            "href",
            "/pricing",
        );
        for (const pointer of CONTACT_COPY.pointers) {
            expect(section).toHaveTextContent(`${pointer.label}: ${pointer.note}`);
        }
        expect(screen.getByRole("link", { name: CONTACT_COPY.backToHome })).toHaveAttribute(
            "href",
            "/",
        );
    });

    it("names the way back for a deployment with no home page", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "");
        render(<ContactPage />);
        expect(screen.getByRole("link", { name: CONTACT_COPY.backToApp })).toHaveAttribute(
            "href",
            "/",
        );
        expect(screen.queryByRole("link", { name: CONTACT_COPY.backToHome })).toBeNull();
    });

    it("keeps its headings in order under one h1", () => {
        render(<ContactPage />);
        const levels = screen
            .getAllByRole("heading")
            .map((heading) => Number(heading.tagName.slice(1)));
        expect(levels).toEqual([1, 2, 2]);
    });

    it("is noindex while the site is not indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        const metadata = generateMetadata();
        expect(metadata.robots).toEqual({ index: false, follow: false });
        expect(String(metadata.title)).toContain(CONTACT_COPY.title);
        expect(String(metadata.title)).toContain(brand.productName);
        expect(metadata.description).toBe(CONTACT_COPY.lede);
    });

    it("leaves indexing to the default once the site is indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        expect(generateMetadata().robots).toBeUndefined();
    });
});
