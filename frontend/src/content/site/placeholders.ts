// SPDX-License-Identifier: AGPL-3.0-only
//
// The `{{token}}` values the public site and documentation pages may use.
// Names, addresses and document locations come from the single brand
// configuration, so no Markdown page carries a hard-coded name or URL; the
// provider table, the security facts and the certification statement come
// from their own registries. An unknown token throws, so a typo fails a test
// instead of reaching a reader as a literal `{{token}}`.
//
// The second half of the file holds the other kind of placeholder: the
// invented matter text the home page's illustration is drawn with.

import { brand } from "@/shared/brand.generated";
import { renderModelProvidersTable } from "@/content/legal/registry";
import { certificationStatement, securityFactsSummary } from "./securityFacts";

/** Where the security.txt file is served, relative to the app origin. */
export const SECURITY_TXT_PATH = "/.well-known/security.txt";

/** Every token a site or docs page may use, resolved. */
export function sitePlaceholders(): Record<string, string> {
    const legal = brand.legalDocuments;
    return {
        productName: brand.productName,
        assistantName: brand.assistantName,
        legalEntityName: brand.legalEntityName,
        appUrl: brand.appUrl,
        supportEmail: brand.supportEmail,
        securityEmail: brand.securityEmail,
        sourceRepositoryUrl: brand.sourceRepositoryUrl,
        upstreamProjectName: brand.upstreamAttribution.projectName,
        upstreamAuthor: brand.upstreamAttribution.author,
        upstreamUrl: brand.upstreamAttribution.url,
        upstreamNotice: brand.upstreamAttribution.notice,
        termsUrl: legal.terms.url,
        privacyUrl: legal.privacy.url,
        dpaUrl: legal.dpa.url,
        subprocessorsUrl: legal.subprocessors.url,
        aupUrl: legal.aup.url,
        aiTransparencyUrl: legal.aiTransparency.url,
        accessibilityUrl: legal.accessibility.url,
        clientAiUseUrl: legal.clientAiUse.url,
        securityUrl: legal.security.url,
        securityTxtPath: SECURITY_TXT_PATH,
        sourcePagePath: "/source",
        modelProvidersTable: renderModelProvidersTable(),
        securityFactsSummary: securityFactsSummary(),
        certificationStatement: certificationStatement(),
    };
}

const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Replace every `{{token}}` in `raw`. Throws on a token `sitePlaceholders`
 * does not define.
 */
export function fillSitePlaceholders(
    raw: string,
    values: Record<string, string> = sitePlaceholders(),
): string {
    return raw.replace(TOKEN, (_match, token: string) => {
        if (!Object.hasOwn(values, token)) {
            throw new Error(`Unknown site content placeholder: {{${token}}}`);
        }
        return values[token];
    });
}

/** Drop a leading HTML comment (the SPDX line) so it never reaches the reader. */
export function stripLeadingComment(raw: string): string {
    return raw.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
}

// ---------------------------------------------------------------------------
// Invented text for the home page's illustration
// ---------------------------------------------------------------------------

/** One invented answer in the illustration, with the passage it quotes. */
export interface VignetteAnswer {
    /** The question a review column asks, in a few words. */
    readonly question: string;
    /** The drafted answer. */
    readonly answer: string;
    /** The passage the answer quotes, as it would appear in the document. */
    readonly quote: string;
    /** Whether the illustration shows the quote as found in the source. */
    readonly found: boolean;
}

/**
 * The text of the home page's product illustration (ProductVignette). All of
 * it is invented for the purpose: there is no such matter, document, party
 * or clause, and the names say so. Nothing here may name a real person, firm
 * or client, or copy a real contract; `siteTemplates.test.ts` checks the
 * names.
 */
export const VIGNETTE_PLACEHOLDERS = {
    /** Printed on the illustration itself, so nobody takes it for a real file. */
    label: "Example with invented text",
    matterName: "Example matter",
    documentName: "Example services agreement",
    answers: [
        {
            question: "Notice to terminate",
            answer: "Either party may end the agreement on ninety days’ written notice.",
            quote: "Either party may terminate this Agreement by giving the other party not less than ninety (90) days’ written notice.",
            found: true,
        },
        {
            question: "Limit on liability",
            answer: "Liability is limited to the fees paid in the previous twelve months.",
            quote: "Each party’s total liability shall not exceed the fees paid in the twelve (12) months before the claim arose.",
            found: false,
        },
    ] as readonly VignetteAnswer[],
} as const;
