// SPDX-License-Identifier: AGPL-3.0-only
//
// Server-only loader for the legal content pages. It reads a Markdown
// template from frontend/src/content/legal, fills its brand placeholders, and
// returns it with the document's registry entry. Imported only by the server
// component at /legal/[doc] (and, later, by /security through the same
// ContentPage), never by a client component: it reads the filesystem.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
    fillPlaceholders,
    legalDocumentForSlug,
    type LegalDocument,
} from "@/content/legal/registry";

// process.cwd() is the frontend/ app root under `next build`, `next dev`, and
// the Vitest run, so the content ships inside the image (frontend/Dockerfile
// copies frontend/) and the pages are generated at build time.
const LEGAL_DIR = path.join(process.cwd(), "src", "content", "legal");

export interface LoadedLegalDocument {
    readonly doc: LegalDocument;
    /** The template with its brand placeholders filled and SPDX comment removed. */
    readonly markdown: string;
}

/** Drop a leading HTML comment (the SPDX line) so it never reaches the reader. */
function stripLeadingComment(raw: string): string {
    return raw.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
}

/** Load and fill a legal page by its URL slug, or null for an unknown slug. */
export function loadLegalDocument(slug: string): LoadedLegalDocument | null {
    const doc = legalDocumentForSlug(slug);
    if (!doc) return null;
    // `doc.file` comes from the registry, never from the slug, so the path is
    // fixed and cannot be steered out of the content directory.
    const raw = readFileSync(path.join(LEGAL_DIR, doc.file), "utf8");
    return { doc, markdown: fillPlaceholders(stripLeadingComment(raw), doc) };
}
