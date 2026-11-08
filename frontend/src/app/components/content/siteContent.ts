// SPDX-License-Identifier: AGPL-3.0-only
//
// Server-only loader for the public site's Markdown pages: the security page
// (frontend/src/content/site/security.md) and the documentation pages
// (frontend/src/content/docs). It reads the file, fills the brand
// placeholders and returns it with its registry entry. Imported only by
// server components under app/(site); never by a client component, because
// it reads the filesystem.

import { readFileSync } from "node:fs";
import path from "node:path";
import { brand } from "@/shared/brand.generated";
import { DOCS_PAGES, docsPageForSlug, type DocsPage } from "@/content/docs/registry";
import { SECURITY_PAGE_COPY } from "@/content/site/chrome";
import {
    fillSitePlaceholders,
    sitePlaceholders,
    stripLeadingComment,
} from "@/content/site/placeholders";

// process.cwd() is the frontend/ app root under `next build`, `next dev` and
// the Vitest run, so the content ships inside the image (frontend/Dockerfile
// copies frontend/) exactly as the legal templates do.
const CONTENT_DIR = path.join(process.cwd(), "src", "content");
const SITE_DIR = path.join(CONTENT_DIR, "site");
const DOCS_DIR = path.join(CONTENT_DIR, "docs");

// The content is fixed when the app is built, but the (site) pages render on
// every request (force-dynamic), and each request renders generateMetadata
// and then the page. So each file is read and filled once per process, the
// first time it is asked for, and served from memory after that. It stays a
// filesystem read, so the image needs nothing it did not already have.
const filledMarkdown = new Map<string, string>();

function fillOnce(
    key: string,
    file: string,
    values?: () => Record<string, string>,
): string {
    const cached = filledMarkdown.get(key);
    if (cached !== undefined) return cached;
    const markdown = fillSitePlaceholders(
        stripLeadingComment(readFileSync(file, "utf8")),
        values?.(),
    );
    filledMarkdown.set(key, markdown);
    return markdown;
}

export interface LoadedSecurityPage {
    readonly title: string;
    /** The filled Markdown body, SPDX comment removed. */
    readonly markdown: string;
    /** From brand.legalDocuments.security: a draft shows the banner and noindex. */
    readonly status: "draft" | "in-effect";
    readonly version: string;
}

/** The public security page, filled from the brand and the facts registries. */
export function loadSecurityPage(): LoadedSecurityPage {
    const doc = brand.legalDocuments.security;
    const markdown = fillOnce(
        `site/security.md@${doc.version}`,
        path.join(SITE_DIR, "security.md"),
        () => ({ ...sitePlaceholders(), version: doc.version }),
    );
    return {
        title: SECURITY_PAGE_COPY.title,
        markdown,
        status: doc.status,
        version: doc.version,
    };
}

export interface LoadedDocsPage {
    readonly page: DocsPage;
    /** The filled Markdown body, SPDX comment removed. */
    readonly markdown: string;
}

/** Load and fill a docs page by its URL slug, or null for an unknown slug. */
export function loadDocsPage(slug: string): LoadedDocsPage | null {
    const page = docsPageForSlug(slug);
    if (!page) return null;
    // `page.file` comes from the registry, never from the slug, so the path is
    // fixed and cannot be steered out of the content directory.
    const markdown = fillOnce(`docs/${page.file}`, path.join(DOCS_DIR, page.file));
    return { page, markdown };
}

/** Every docs page, in index order. */
export function listDocsPages(): readonly DocsPage[] {
    return DOCS_PAGES;
}
