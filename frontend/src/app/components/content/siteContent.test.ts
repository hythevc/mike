// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import { DOCS_PAGES } from "@/content/docs/registry";
import { SECURITY_PAGE_COPY } from "@/content/site/chrome";
import { NO_INDEPENDENT_CERTIFICATION } from "@/content/site/securityFacts";

// The real filesystem, with readFileSync counted: the last test shows that a
// page's file is read once, however many requests render it.
vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { listDocsPages, loadDocsPage, loadSecurityPage } from "./siteContent";

describe("loadSecurityPage", () => {
    it("fills the security page from the brand and the facts registries", () => {
        const page = loadSecurityPage();
        expect(page.title).toBe(SECURITY_PAGE_COPY.title);
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

describe("one read per file", () => {
    it("reads and fills each file once, however many requests render it", async () => {
        // A fresh module instance, so its cache starts empty whatever the
        // tests above loaded; node:fs is the counted one declared above.
        vi.resetModules();
        const fs = await import("node:fs");
        const fresh = await import("./siteContent");
        const reads = vi.mocked(fs.readFileSync);
        reads.mockClear();

        const security = fresh.loadSecurityPage();
        expect(fresh.loadSecurityPage()).toEqual(security);
        const docs = fresh.loadDocsPage("getting-started");
        expect(fresh.loadDocsPage("getting-started")).toEqual(docs);
        fresh.loadDocsPage("data-and-privacy");

        const files = reads.mock.calls.map(([file]) => String(file));
        expect(files.filter((file) => file.endsWith("security.md"))).toHaveLength(1);
        expect(files.filter((file) => file.endsWith("getting-started.md"))).toHaveLength(1);
        expect(files.filter((file) => file.endsWith("data-and-privacy.md"))).toHaveLength(1);
    });
});
