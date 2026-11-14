// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    SECURITY_FACTS_COPY,
    securityFactLine,
    securityFacts,
    trustStripFacts,
} from "@/content/site/securityFacts";
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

    it("lists every fact of the registry in its summary, each with its status", () => {
        render(<SecurityPage />);
        const summary = screen.getByRole("heading", { level: 2, name: "Summary" });
        const firstSection = screen.getByRole("heading", {
            level: 2,
            name: "Stored provider keys",
        });
        const inSummary = (node: Element) =>
            Boolean(summary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            Boolean(firstSection.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);

        const lead = screen.getByText(SECURITY_FACTS_COPY.inPlaceLead);
        expect(inSummary(lead)).toBe(true);
        const facts = securityFacts();
        expect(facts.length).toBeGreaterThan(4);
        for (const fact of facts) {
            // The registry's own sentence, once, between the two headings.
            const line = screen.getByText(securityFactLine(fact));
            expect(inSummary(line), fact.id).toBe(true);
            if (fact.status === "in place") expect(line.tagName, fact.id).toBe("LI");
        }
        // Nothing is planned today, so no such list is shown.
        expect(screen.queryByText(SECURITY_FACTS_COPY.plannedLead)).toBeNull();
    });

    it("carries, word for word, every fact the pricing page shows under its action", () => {
        render(<SecurityPage />);
        const strip = trustStripFacts();
        expect(strip.length).toBeGreaterThan(0);
        for (const fact of strip) {
            expect(screen.getByText(securityFactLine(fact))).toBeInTheDocument();
        }
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
