// SPDX-License-Identifier: AGPL-3.0-only
//
// The typed registry of public documentation pages (/docs). Each entry names
// the Markdown file beside this one, its title, a one-line summary for the
// index, and the headings the page must carry; the content tests read it so
// the set of pages stays in step with the files. The pages fill the same
// brand placeholders as the rest of the site (content/site/placeholders.ts).

import { SITE_CHROME_COPY } from "@/content/site/chrome";

export interface DocsPage {
    /** URL segment under /docs/. */
    readonly slug: string;
    /** The page heading and metadata title. */
    readonly title: string;
    /** One sentence for the index and the page description. */
    readonly summary: string;
    /** The Markdown file in this directory. */
    readonly file: string;
    /** Lower-case substrings that each must appear in one of the page's headings. */
    readonly requiredHeadings: readonly string[];
}

export const DOCS_PAGES: readonly DocsPage[] = [
    {
        slug: "getting-started",
        title: "Getting started",
        summary:
            "Create an account, connect a model, try the sample matter and invite your colleagues.",
        file: "getting-started.md",
        requiredHeadings: [
            "create an account",
            "connect a model",
            "sample matter",
            "ask a question",
            "review",
            "word",
        ],
    },
    {
        slug: "tabular-review-and-quote-status",
        title: "Tabular review and quote status",
        summary:
            "What each cell's quote status means, what is checked, what is not, and how the evidence survives export.",
        file: "tabular-review-and-quote-status.md",
        requiredHeadings: [
            "what each status means",
            "what is not checked",
            "stale",
            "export",
        ],
    },
    {
        slug: "data-and-privacy",
        title: "Data and privacy",
        summary:
            "What is stored, who processes it, how AI use on a matter is controlled, and how to export or delete your data.",
        file: "data-and-privacy.md",
        requiredHeadings: [
            "what is stored",
            "model providers",
            "ai use on a matter",
            "export",
            "delet",
        ],
    },
    {
        slug: "source-code-and-licences",
        title: "Source code and licences",
        summary:
            "The licence the service runs under, where its source is, how it credits the project it is based on, and how workflow credits work.",
        file: "source-code-and-licences.md",
        requiredHeadings: [
            "licence",
            "corresponding source",
            "based on",
            "workflow",
            "self-host",
        ],
    },
];

/** Copy for the documentation index page (/docs). */
export const DOCS_INDEX_COPY = {
    title: "Documentation",
    intro: "How the product works, what it checks and what it does not, how your data is handled, and where its source code is.",
    disclaimer: SITE_CHROME_COPY.disclaimer,
} as const;

/** The URL slugs of every docs page. */
export const DOCS_PAGE_SLUGS: readonly string[] = DOCS_PAGES.map(
    (page) => page.slug,
);

/** The docs page for a URL slug, or undefined for an unknown slug. */
export function docsPageForSlug(slug: string): DocsPage | undefined {
    return DOCS_PAGES.find((page) => page.slug === slug);
}
