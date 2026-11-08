// SPDX-License-Identifier: AGPL-3.0-only
//
// The `{{token}}` values the public site and documentation pages may use.
// Names, addresses and document locations come from the single brand
// configuration, so no Markdown page carries a hard-coded name or URL; the
// provider table and the certification statement come from their own
// registries. An unknown token throws, so a typo fails a test instead of
// reaching a reader as a literal `{{token}}`.

import { brand } from "@/shared/brand.generated";
import { renderModelProvidersTable } from "@/content/legal/registry";
import { certificationStatement } from "./securityFacts";

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
