// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Required-headings and placeholder tests for the public site's Markdown:
// the four documentation pages (registry in ../docs) and the security page
// (../site/security.md). The content lint (contentLint.test.ts) already
// scans these files for over-claims and the disclaimer; this test checks
// their structure and that every placeholder resolves.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_PAGES, docsPageForSlug } from "../docs/registry";
import {
    fillSitePlaceholders,
    sitePlaceholders,
    stripLeadingComment,
} from "../site/placeholders";
import {
    NO_INDEPENDENT_CERTIFICATION,
    certificationStatement,
} from "../site/securityFacts";

const DOCS_DIR = path.resolve(__dirname, "..", "docs");
const SITE_DIR = path.resolve(__dirname, "..", "site");

/** The text of every Markdown heading in `markdown`, lower-cased. */
function headings(markdown: string): string[] {
    return markdown
        .split("\n")
        .map((line) => /^#{1,6}\s+(.*)$/.exec(line.trim()))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match[1].trim().toLowerCase());
}

function missingHeadings(markdown: string, required: readonly string[]): string[] {
    const found = headings(markdown);
    return required.filter((needle) => !found.some((heading) => heading.includes(needle)));
}

const SECURITY_REQUIRED_HEADINGS = [
    "stored provider keys",
    "sign-in and sessions",
    "multi-factor authentication",
    "single sign-on",
    "audit log and what it records",
    "export and deletion",
    "model providers and training",
    "matter-level controls",
    "error reporting",
    "independent certification",
    "reporting a vulnerability",
];

describe("documentation pages", () => {
    it("registers exactly the four pages the site links to", () => {
        expect(DOCS_PAGES.map((page) => page.slug)).toEqual([
            "getting-started",
            "tabular-review-and-quote-status",
            "data-and-privacy",
            "source-code-and-licences",
        ]);
        expect(docsPageForSlug("data-and-privacy")?.title).toBe("Data and privacy");
        expect(docsPageForSlug("nope")).toBeUndefined();
    });

    it.each(DOCS_PAGES.map((page) => [page.slug, page] as const))(
        "%s exists, carries its required headings and fills every placeholder",
        (_slug, page) => {
            const file = path.join(DOCS_DIR, page.file);
            expect(existsSync(file), `${page.file} exists`).toBe(true);
            const raw = readFileSync(file, "utf8");
            expect(raw.startsWith("<!-- SPDX-License-Identifier: AGPL-3.0-only -->")).toBe(true);
            expect(missingHeadings(raw, page.requiredHeadings)).toEqual([]);
            const filled = fillSitePlaceholders(stripLeadingComment(raw));
            expect(filled).not.toContain("{{");
            expect(filled).not.toContain("}}");
            expect(filled).toMatch(/legal information,?\s+not legal advice/i);
        },
    );

    it("fails a page that lacks a required heading", () => {
        const page = docsPageForSlug("tabular-review-and-quote-status")!;
        const broken = "## What each status means\n\nText.\n\n## Export\n\nText.";
        expect(missingHeadings(broken, page.requiredHeadings)).toEqual([
            "what is not checked",
            "stale",
        ]);
    });
});

describe("security page", () => {
    const raw = readFileSync(path.join(SITE_DIR, "security.md"), "utf8");

    it("states each required fact under its own heading", () => {
        expect(missingHeadings(raw, SECURITY_REQUIRED_HEADINGS)).toEqual([]);
    });

    it("fills every placeholder, including the version a page supplies", () => {
        const filled = fillSitePlaceholders(stripLeadingComment(raw), {
            ...sitePlaceholders(),
            version: "0.1.0",
        });
        expect(filled).not.toContain("{{");
        expect(filled).toContain("Document version 0.1.0.");
        expect(filled).toContain(NO_INDEPENDENT_CERTIFICATION);
        expect(filled).toMatch(/legal information,?\s+not legal advice/i);
        // Facts the page must carry, in its own words.
        expect(filled).toMatch(/AES-256-GCM/);
        expect(filled).toMatch(/authenticator app/i);
        expect(filled).toMatch(/SAML single sign-on/);
        expect(filled).toMatch(/does not train models on your content/);
        expect(filled).toMatch(/\/\.well-known\/security\.txt/);
    });

    it("says there is no independent certification until one is recorded", () => {
        expect(certificationStatement([])).toBe(NO_INDEPENDENT_CERTIFICATION);
        expect(certificationStatement()).toBe(NO_INDEPENDENT_CERTIFICATION);
        const listed = certificationStatement([
            {
                name: "Example assessment",
                assessor: "Example assessor",
                completed: "2026-01",
                scope: "The web application and API.",
            },
        ]);
        expect(listed).toContain("**Example assessment** by Example assessor, completed 2026-01");
        expect(listed).not.toContain(NO_INDEPENDENT_CERTIFICATION);
    });
});

describe("site placeholders", () => {
    it("throws on an unknown token", () => {
        expect(() => fillSitePlaceholders("Hello {{notAToken}}.")).toThrow(/notAToken/);
    });

    it("strips only a leading HTML comment", () => {
        expect(stripLeadingComment("<!-- SPDX -->\n\n# Title\n<!-- keep -->")).toBe(
            "# Title\n<!-- keep -->",
        );
        expect(stripLeadingComment("# Title")).toBe("# Title");
    });
});
