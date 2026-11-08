// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Required-headings test: every legal template carries the headings its
// registry entry lists (for the DPA, sub-processor authorisation and
// objection, breach notification, deletion or return, and audit rights; for
// the AI statement, providers, inference region, retention and ZDR, no
// training, and known limitations). Also checks that every template fills its
// brand placeholders without leaving a literal {{token}} behind.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    LEGAL_DOCUMENTS,
    fillPlaceholders,
    type LegalDocument,
} from "../legal/registry";

const LEGAL_DIR = path.resolve(__dirname, "..", "legal");

function readTemplate(doc: LegalDocument): string {
    return readFileSync(path.join(LEGAL_DIR, doc.file), "utf8");
}

/** The text of every Markdown heading in `markdown`, lower-cased. */
function headings(markdown: string): string[] {
    return markdown
        .split("\n")
        .map((line) => /^#{1,6}\s+(.*)$/.exec(line.trim()))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match[1].trim().toLowerCase());
}

/** Required heading substrings that no heading in `markdown` contains. */
function missingHeadings(
    markdown: string,
    required: readonly string[],
): string[] {
    const found = headings(markdown);
    return required.filter(
        (needle) => !found.some((heading) => heading.includes(needle)),
    );
}

describe("legal templates carry their required headings", () => {
    it.each(LEGAL_DOCUMENTS.map((doc) => [doc.slug, doc] as const))(
        "%s has every required heading",
        (_slug, doc) => {
            const markdown = readTemplate(doc);
            expect(missingHeadings(markdown, doc.requiredHeadings)).toEqual([]);
        },
    );

    it("fails a DPA that is missing breach notification", () => {
        const dpa = LEGAL_DOCUMENTS.find((doc) => doc.slug === "dpa");
        expect(dpa).toBeDefined();
        const brokenDpa = [
            "## Sub-processors: authorisation and objection",
            "Text.",
            "## Deletion or return of personal data",
            "Text.",
            "## Audit rights",
            "Text.",
        ].join("\n\n");
        expect(missingHeadings(brokenDpa, dpa!.requiredHeadings)).toContain(
            "breach notification",
        );
    });

    it("fails an AI statement that is missing the no-training heading", () => {
        const ai = LEGAL_DOCUMENTS.find((doc) => doc.slug === "ai-transparency");
        expect(ai).toBeDefined();
        const brokenAi = [
            "## Providers we use",
            "## Inference region",
            "## Retention and zero data retention",
            "## Known limitations",
        ].join("\n\n");
        expect(missingHeadings(brokenAi, ai!.requiredHeadings)).toContain(
            "no training",
        );
    });
});

describe("legal templates fill their placeholders", () => {
    it.each(LEGAL_DOCUMENTS.map((doc) => [doc.slug, doc] as const))(
        "%s fills every placeholder and leaves none behind",
        (_slug, doc) => {
            const raw = readTemplate(doc);
            const filled = fillPlaceholders(raw, doc);
            expect(filled).not.toContain("{{");
            expect(filled).not.toContain("}}");
        },
    );

    it("throws on an unknown placeholder token", () => {
        const doc = LEGAL_DOCUMENTS[0];
        expect(() => fillPlaceholders("Hello {{notAToken}}.", doc)).toThrow(
            /notAToken/,
        );
    });

    it("expands the provider tables into the subprocessors page", () => {
        const subs = LEGAL_DOCUMENTS.find((doc) => doc.slug === "subprocessors");
        expect(subs).toBeDefined();
        const filled = fillPlaceholders(readTemplate(subs!), subs!);
        // The placeholder rows carry a region and a retention/ZDR status.
        expect(filled).toContain("United States");
        expect(filled.toLowerCase()).toContain("zero data retention");
        expect(filled).toContain("| Provider | Region |");
    });
});
