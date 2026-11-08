// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import SecurityPage, { generateMetadata } from "./page";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("/security", () => {
    it("renders the security facts page with the brand's mailbox and the draft banner", () => {
        render(<SecurityPage />);
        expect(screen.getByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: brand.securityEmail })).toHaveAttribute(
            "href",
            `mailto:${brand.securityEmail}`,
        );
        expect(screen.getByText(/No independent certification yet/)).toBeInTheDocument();
        expect(screen.getByText(/legal information, not legal advice/i)).toBeInTheDocument();
        if (brand.legalDocuments.security.status === "draft") {
            expect(
                screen.getByText("Draft, not in effect, pending counsel review."),
            ).toBeInTheDocument();
        }
        expect(
            screen.getByText(new RegExp(`Version ${brand.legalDocuments.security.version}`)),
        ).toBeInTheDocument();
    });

    it("keeps a draft out of search engines even when the site is indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        const metadata = generateMetadata();
        expect(String(metadata.title)).toContain("Security");
        expect(String(metadata.title)).toContain(brand.productName);
        if (brand.legalDocuments.security.status === "draft") {
            expect(metadata.robots).toEqual({ index: false, follow: false });
        } else {
            expect(metadata.robots).toBeUndefined();
        }
    });

    it("is noindex while the site is not indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        expect(generateMetadata().robots).toEqual({ index: false, follow: false });
    });
});
