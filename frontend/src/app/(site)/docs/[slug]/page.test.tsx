// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import { DOCS_PAGES } from "@/content/docs/registry";

vi.mock("next/navigation", () => ({
    notFound: () => {
        throw new Error("NOT_FOUND");
    },
}));

import DocsPage, { generateMetadata } from "./page";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/docs/[slug]", () => {
    it.each(DOCS_PAGES.map((page) => [page.slug, page.title] as const))(
        "renders %s with its title and a way back to the index",
        async (slug, title) => {
            render(await DocsPage(params(slug)));
            expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
            expect(
                screen.getByRole("navigation", { name: "Breadcrumb" }).querySelector("a"),
            ).toHaveAttribute("href", "/docs");
            // Documentation is not a versioned legal document: no banner, no version line.
            expect(screen.queryByText(/pending counsel review/)).not.toBeInTheDocument();
            expect(screen.queryByText(/^Version /)).not.toBeInTheDocument();
        },
    );

    it("returns not found for an unknown page", async () => {
        await expect(DocsPage(params("not-a-page"))).rejects.toThrow("NOT_FOUND");
    });

    it("titles the page with the brand and describes it with its summary", async () => {
        const metadata = await generateMetadata(params("getting-started"));
        expect(String(metadata.title)).toBe(`Getting started · ${brand.productName}`);
        expect(metadata.description).toBe(DOCS_PAGES[0].summary);
        expect(await generateMetadata(params("nope"))).toEqual({});
    });
});
