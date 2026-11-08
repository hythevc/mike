// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOCS_INDEX_COPY, DOCS_PAGES } from "@/content/docs/registry";
import DocsIndexPage, { metadata } from "./page";

describe("/docs", () => {
    it("lists every documentation page with a link", () => {
        render(<DocsIndexPage />);
        expect(
            screen.getByRole("heading", { level: 1, name: DOCS_INDEX_COPY.title }),
        ).toBeInTheDocument();
        for (const page of DOCS_PAGES) {
            expect(screen.getByRole("link", { name: page.title })).toHaveAttribute(
                "href",
                `/docs/${page.slug}`,
            );
            expect(screen.getByText(page.summary)).toBeInTheDocument();
        }
        expect(screen.getByText(DOCS_INDEX_COPY.disclaimer)).toBeInTheDocument();
        expect(String(metadata.title)).toContain(DOCS_INDEX_COPY.title);
    });
});
