// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/shared/brand.generated";
import { DOCS_PAGES } from "@/content/docs/registry";
import { NO_INDEPENDENT_CERTIFICATION } from "@/content/site/securityFacts";
import {
    SECURITY_PAGE_TITLE,
    listDocsPages,
    loadDocsPage,
    loadSecurityPage,
} from "./siteContent";

describe("loadSecurityPage", () => {
    it("fills the security page from the brand and the facts registries", () => {
        const page = loadSecurityPage();
        expect(page.title).toBe(SECURITY_PAGE_TITLE);
        expect(page.status).toBe(brand.legalDocuments.security.status);
        expect(page.version).toBe(brand.legalDocuments.security.version);
        expect(page.markdown).not.toContain("{{");
        expect(page.markdown).not.toContain("<!--");
        expect(page.markdown).toContain(`mailto:${brand.securityEmail}`);
        expect(page.markdown).toContain(brand.legalEntityName);
        expect(page.markdown).toContain(NO_INDEPENDENT_CERTIFICATION);
        expect(page.markdown).toContain(`Document version ${page.version}.`);
        // The configured model providers, with their training position.
        expect(page.markdown).toContain("| Provider | Region |");
    });
});

describe("loadDocsPage", () => {
    it("returns null for an unknown slug", () => {
        expect(loadDocsPage("not-a-page")).toBeNull();
        expect(loadDocsPage("../legal/terms")).toBeNull();
    });

    it.each(DOCS_PAGES.map((page) => [page.slug] as const))(
        "fills %s with no placeholder or SPDX comment left",
        (slug) => {
            const loaded = loadDocsPage(slug);
            expect(loaded).not.toBeNull();
            expect(loaded!.page.slug).toBe(slug);
            expect(loaded!.markdown).not.toContain("{{");
            expect(loaded!.markdown).not.toContain("<!--");
            expect(loaded!.markdown).toMatch(/legal information,?\s+not legal advice/i);
        },
    );

    it("lists every registered page in order", () => {
        expect(listDocsPages().map((page) => page.slug)).toEqual(
            DOCS_PAGES.map((page) => page.slug),
        );
    });
});
