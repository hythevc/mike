// SPDX-License-Identifier: AGPL-3.0-only
//
// The typed registry of legal content pages. Each page's version, status and
// URL come from the single brand configuration (brand.legalDocuments); this
// file adds the human title, the Markdown filename, and the headings a page
// must carry. The pages render through ContentPage at /legal/[doc], and the
// content tests read this registry so the set of pages, their headings and
// their placeholders stay in step with the Markdown.
//
// The provider rows below are PLACEHOLDERS. The operator replaces them with
// the real sub-processors and model providers, each with its region and its
// retention or zero-data-retention (ZDR) status, before the service is
// offered. They are intentionally not real vendors.

import { brand, type BrandLegalDocumentKey } from "@/shared/brand.generated";

/** A legal content page as the application needs it: brand facts plus content. */
export interface LegalDocument {
    /** URL segment under /legal/, e.g. "ai-transparency". */
    readonly slug: string;
    /** The key of this document in brand.legalDocuments. */
    readonly brandKey: BrandLegalDocumentKey;
    /** The page heading and metadata title. */
    readonly title: string;
    /** The Markdown file in this directory. */
    readonly file: string;
    /** The version users are shown or accept, from the brand config. */
    readonly version: string;
    /** Whether the version is in effect or still a draft, from the brand config. */
    readonly status: "draft" | "in-effect";
    /** Where the document is published, from the brand config. */
    readonly url: string;
    /** Lower-case substrings that each must appear in one of the page's headings. */
    readonly requiredHeadings: readonly string[];
}

interface LegalDocumentMeta {
    readonly slug: string;
    readonly brandKey: BrandLegalDocumentKey;
    readonly title: string;
    readonly file: string;
    readonly requiredHeadings: readonly string[];
}

// The pages served under /legal/. brand.legalDocuments also carries "security"
// (published at /security), which is not a /legal page and is intentionally
// absent here.
const LEGAL_DOCUMENT_META: readonly LegalDocumentMeta[] = [
    {
        slug: "terms",
        brandKey: "terms",
        title: "Terms of Service",
        file: "terms.md",
        requiredHeadings: [
            "the service",
            "acceptable use",
            "warranties",
            "limitation of liability",
            "governing law",
        ],
    },
    {
        slug: "privacy",
        brandKey: "privacy",
        title: "Privacy Notice",
        file: "privacy.md",
        requiredHeadings: [
            "what we collect",
            "how we use",
            "retention",
            "your rights",
        ],
    },
    {
        slug: "dpa",
        brandKey: "dpa",
        title: "Data Processing Agreement",
        file: "dpa.md",
        requiredHeadings: [
            "sub-processor",
            "objection",
            "breach notification",
            "deletion or return",
            "audit",
        ],
    },
    {
        slug: "subprocessors",
        brandKey: "subprocessors",
        title: "Subprocessors and model providers",
        file: "subprocessors.md",
        requiredHeadings: ["sub-processor", "model provider"],
    },
    {
        slug: "aup",
        brandKey: "aup",
        title: "Acceptable Use Policy",
        file: "aup.md",
        requiredHeadings: ["you must not", "enforcement"],
    },
    {
        slug: "ai-transparency",
        brandKey: "aiTransparency",
        title: "How we use AI",
        file: "ai-transparency.md",
        requiredHeadings: [
            "providers",
            "inference region",
            "retention and zero data retention",
            "no training",
            "known limitations",
        ],
    },
    {
        slug: "accessibility",
        brandKey: "accessibility",
        title: "Accessibility statement",
        file: "accessibility.md",
        requiredHeadings: ["our target", "feedback"],
    },
    {
        slug: "cookies",
        brandKey: "cookies",
        title: "Cookie Notice",
        file: "cookies.md",
        requiredHeadings: ["what we use", "managing cookies"],
    },
    {
        slug: "client-ai-use",
        brandKey: "clientAiUse",
        title: "Using AI on your matter: a note for clients",
        file: "client-ai-use.md",
        requiredHeadings: ["how we use ai", "engagement letter clause"],
    },
];

function resolve(meta: LegalDocumentMeta): LegalDocument {
    const brandDoc = brand.legalDocuments[meta.brandKey];
    return {
        slug: meta.slug,
        brandKey: meta.brandKey,
        title: meta.title,
        file: meta.file,
        version: brandDoc.version,
        status: brandDoc.status,
        url: brandDoc.url,
        requiredHeadings: meta.requiredHeadings,
    };
}

/** Every legal content page, in display order. */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] =
    LEGAL_DOCUMENT_META.map(resolve);

/** The URL slugs of every legal content page, for static route generation. */
export const LEGAL_DOCUMENT_SLUGS: readonly string[] = LEGAL_DOCUMENTS.map(
    (doc) => doc.slug,
);

/** The legal page for a URL slug, or undefined for an unknown slug. */
export function legalDocumentForSlug(
    slug: string,
): LegalDocument | undefined {
    return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}

/** The legal page for a brand key, or undefined when it has no /legal page. */
export function legalDocumentForBrandKey(
    brandKey: BrandLegalDocumentKey,
): LegalDocument | undefined {
    return LEGAL_DOCUMENTS.find((doc) => doc.brandKey === brandKey);
}

// ---------------------------------------------------------------------------
// Operator-provided provider lists (placeholders — not real vendors)
// ---------------------------------------------------------------------------

/** A sub-processor row: who, why, where, and how the data is handled. */
export interface SubprocessorRow {
    readonly name: string;
    readonly purpose: string;
    readonly region: string;
    readonly dataHandling: string;
}

/** A model-provider row: who, where, how data is handled, and training. */
export interface ModelProviderRow {
    readonly name: string;
    readonly region: string;
    readonly dataHandling: string;
    readonly training: string;
}

export const SUBPROCESSORS: readonly SubprocessorRow[] = [
    {
        name: "[Cloud hosting and database provider]",
        purpose: "Application hosting, database and file storage",
        region: "United States",
        dataHandling:
            "Stores account data and uploaded documents for the life of the account; removed within 30 days of deletion",
    },
    {
        name: "[Transactional email provider]",
        purpose: "Sign-in and account notification emails",
        region: "United States",
        dataHandling:
            "Processes the recipient address and message to deliver the email; not used for training",
    },
];

export const MODEL_PROVIDERS: readonly ModelProviderRow[] = [
    {
        name: "[Primary model provider]",
        region: "United States",
        dataHandling:
            "Zero data retention (ZDR): prompts and outputs are not stored after the response is returned",
        training: "Not used to train models",
    },
    {
        name: "[Secondary model provider]",
        region: "United States",
        dataHandling:
            "Retains prompts and outputs for up to 30 days for abuse monitoring, then deletes them",
        training: "Not used to train models",
    },
];

function markdownTable(
    headers: readonly string[],
    rows: readonly (readonly string[])[],
): string {
    const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
    return [
        line(headers),
        line(headers.map(() => "---")),
        ...rows.map(line),
    ].join("\n");
}

export function renderSubprocessorsTable(
    rows: readonly SubprocessorRow[] = SUBPROCESSORS,
): string {
    return markdownTable(
        ["Sub-processor", "Purpose", "Region", "Data handling"],
        rows.map((r) => [r.name, r.purpose, r.region, r.dataHandling]),
    );
}

export function renderModelProvidersTable(
    rows: readonly ModelProviderRow[] = MODEL_PROVIDERS,
): string {
    return markdownTable(
        ["Provider", "Region", "Data handling", "Training"],
        rows.map((r) => [r.name, r.region, r.dataHandling, r.training]),
    );
}

// ---------------------------------------------------------------------------
// Placeholder filling
// ---------------------------------------------------------------------------

/**
 * The tokens a template may use, each resolved for a document. Brand facts
 * come from the single brand configuration so nothing is hard-coded in the
 * Markdown; `version` is the document's own version; the two table tokens
 * expand to the provider lists above.
 */
export function legalPlaceholders(doc: LegalDocument): Record<string, string> {
    return {
        productName: brand.productName,
        assistantName: brand.assistantName,
        legalEntityName: brand.legalEntityName,
        appUrl: brand.appUrl,
        marketingUrl: brand.marketingUrl,
        supportEmail: brand.supportEmail,
        securityEmail: brand.securityEmail,
        docsUrl: brand.docsUrl,
        changelogUrl: brand.changelogUrl,
        sourceRepositoryUrl: brand.sourceRepositoryUrl,
        version: doc.version,
        subprocessorsTable: renderSubprocessorsTable(),
        modelProvidersTable: renderModelProvidersTable(),
    };
}

const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Replace every `{{token}}` in `raw` with its value for `doc`. Throws on an
 * unknown token so a typo fails a test rather than shipping a literal
 * `{{token}}` to a user.
 */
export function fillPlaceholders(raw: string, doc: LegalDocument): string {
    const values = legalPlaceholders(doc);
    return raw.replace(TOKEN, (_match, token: string) => {
        if (!Object.hasOwn(values, token)) {
            throw new Error(`Unknown legal template placeholder: {{${token}}}`);
        }
        return values[token];
    });
}
