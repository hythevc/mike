// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Required-headings and placeholder tests for the public site's Markdown:
// the four documentation pages (registry in ../docs) and the security page
// (../site/security.md), and structure tests for the site's copy modules
// (home, pricing, contact, the frame around them and the illustration's
// invented text). The content lint (contentLint.test.ts) already scans these
// files for over-claims and the disclaimer; this test checks their structure,
// that every placeholder resolves and that every link in the copy leads to a
// page that exists.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "@/shared/brand.generated";
import { DOCS_PAGES, DOCS_PAGE_SLUGS, docsPageForSlug } from "../docs/registry";
import { CONTACT_PATH, SITE_CHROME_COPY } from "../site/chrome";
import { CONTACT_COPY, contactMailto } from "../site/contact";
import { HOME_COPY } from "../site/home";
import {
    VIGNETTE_PLACEHOLDERS,
    fillSitePlaceholders,
    sitePlaceholders,
    stripLeadingComment,
} from "../site/placeholders";
import { PRICING_COPY } from "../site/pricing";
import {
    NO_INDEPENDENT_CERTIFICATION,
    SECURITY_FACTS_COPY,
    certificationStatement,
    securityFactLine,
    securityFacts,
} from "../site/securityFacts";

const DOCS_DIR = path.resolve(__dirname, "..", "docs");
const SITE_DIR = path.resolve(__dirname, "..", "site");
const APP_DIR = path.resolve(__dirname, "..", "..", "app");

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

/**
 * Whether a path in the site's copy is a page the app serves: the home page,
 * a documentation page in the registry, or a route with its own page file,
 * inside the (site) group or beside it.
 */
function pageExists(href: string): boolean {
    if (href === "/") return true;
    const docs = /^\/docs\/([^/]+)$/.exec(href);
    if (docs) return DOCS_PAGE_SLUGS.includes(docs[1]);
    const segments = href.replace(/^\//, "").split("/");
    return [path.join(APP_DIR, "(site)"), APP_DIR].some((root) =>
        existsSync(path.join(root, ...segments, "page.tsx")),
    );
}

const SECURITY_REQUIRED_HEADINGS = [
    "summary",
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
    const fill = () =>
        fillSitePlaceholders(stripLeadingComment(raw), {
            ...sitePlaceholders(),
            version: "0.1.0",
        });

    it("states each required fact under its own heading", () => {
        expect(missingHeadings(raw, SECURITY_REQUIRED_HEADINGS)).toEqual([]);
    });

    it("fills every placeholder, including the version a page supplies", () => {
        const filled = fill();
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

    it("lists every fact of the registry in its summary, in the registry's own words", () => {
        const filled = fill();
        const summary = filled.slice(
            filled.indexOf("## Summary"),
            filled.indexOf("## Stored provider keys"),
        );
        expect(summary).toContain(SECURITY_FACTS_COPY.inPlaceLead);
        for (const fact of securityFacts()) {
            expect(summary, fact.id).toContain(securityFactLine(fact));
        }
        // Nothing is planned today, so the page has no such list.
        expect(securityFacts().some((fact) => fact.status === "planned")).toBe(false);
        expect(summary).not.toContain(SECURITY_FACTS_COPY.plannedLead);
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

describe("links in the site copy", () => {
    it("lead to pages that exist", () => {
        const hrefs = [
            ...SITE_CHROME_COPY.nav.map((item) => item.href),
            CONTACT_PATH,
            ...HOME_COPY.facts.flatMap((fact) => (fact.link ? [fact.link.href] : [])),
            ...CONTACT_COPY.pointers.map((pointer) => pointer.href),
            PRICING_COPY.billingOff.href,
            PRICING_COPY.unavailableContact.href,
            brand.legalDocuments.security.url,
        ];
        expect(hrefs.length).toBeGreaterThan(8);
        for (const href of hrefs) {
            expect(pageExists(href), `${href} must be a page of the app`).toBe(true);
        }
    });

    it("the check itself refuses a path with no page", () => {
        expect(pageExists("/no-such-page")).toBe(false);
        expect(pageExists("/docs/no-such-page")).toBe(false);
    });
});

describe("home page copy", () => {
    it("has a headline, a lede, one action and the links that step down from it", () => {
        expect(HOME_COPY.headline.length).toBeGreaterThan(10);
        expect(HOME_COPY.lede).toContain(brand.productName);
        expect(HOME_COPY.primaryAction).toBe(SITE_CHROME_COPY.createAccount);
        expect(HOME_COPY.secondaryAction).toBe(SITE_CHROME_COPY.signIn);
        expect(HOME_COPY.actionNote).toMatch(/sample matter/);
    });

    it("gives every step and every fact a title and a body, with no title used twice", () => {
        const entries = [...HOME_COPY.steps, ...HOME_COPY.facts];
        for (const entry of entries) {
            expect(entry.title.trim()).not.toBe("");
            expect(entry.body.trim().endsWith(".")).toBe(true);
        }
        const titles = entries.map((entry) => entry.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it("says what the illustration shows, including the quote that was not found", () => {
        expect(HOME_COPY.vignetteCaption).toMatch(/invented/i);
        expect(HOME_COPY.vignetteCaption).toMatch(/one was not/i);
        expect(HOME_COPY.vignetteCaption).toMatch(/not that the answer is right/i);
    });

    it("carries the disclaimer and names the product from the brand module", () => {
        expect(HOME_COPY.disclaimer).toBe(SITE_CHROME_COPY.disclaimer);
        expect(HOME_COPY.limitsBody).toContain(brand.productName);
        expect(JSON.stringify(HOME_COPY)).not.toContain(brand.upstreamAttribution.projectName);
    });
});

describe("the illustration's invented text", () => {
    const { label, matterName, documentName, answers } = VIGNETTE_PLACEHOLDERS;

    it("says on its face that it is an example with invented text", () => {
        expect(label).toMatch(/example/i);
        expect(label).toMatch(/invented/i);
        expect(matterName).toMatch(/^Example\b/);
        expect(documentName).toMatch(/^Example\b/);
    });

    it("shows a quote that was found and one that was not", () => {
        expect(answers.map((answer) => answer.found).sort()).toEqual([false, true]);
        for (const answer of answers) {
            for (const text of [answer.question, answer.answer, answer.quote]) {
                expect(text.trim()).not.toBe("");
            }
        }
    });

    it("names no party, person, firm or place, and never the product or its origin", () => {
        const text = JSON.stringify(VIGNETTE_PLACEHOLDERS);
        expect(text).not.toContain(brand.productName);
        expect(text).not.toContain(brand.upstreamAttribution.projectName);
        expect(text).not.toMatch(/\b(?:Inc|LLC|LLP|Ltd|GmbH|PLC|Corp)\b\.?/);
        // Parties are "either party" and "each party": no capitalised name
        // follows a title or stands in for a signatory.
        expect(text).not.toMatch(/\b(?:Mr|Mrs|Ms|Dr)\.? [A-Z]/);
    });
});

describe("pricing page copy", () => {
    it("states no price, currency or saving of its own", () => {
        const text = JSON.stringify(PRICING_COPY);
        expect(text).not.toMatch(/[$€£¥]/);
        expect(text).not.toMatch(/\d/);
        expect(text).not.toMatch(/\b(?:save|saving|discount|recommended|most popular|best value)\b/i);
    });

    it("counts seats and trial days in words that agree with the number", () => {
        expect(PRICING_COPY.seatLimit(1)).toBe("1 seat");
        expect(PRICING_COPY.seatLimit(5)).toBe("Up to 5 seats");
        expect(PRICING_COPY.seatLimit(1000)).toBe("Up to 1,000 seats");
        expect(PRICING_COPY.trial(1)).toBe("1-day trial");
        expect(PRICING_COPY.trial(14)).toBe("14-day trial");
    });

    it("says what a price covers only in the catalog's own terms", () => {
        expect(PRICING_COPY.pricePer("month")).toBe("per month");
        expect(PRICING_COPY.pricePerSeat).toBe("per seat");
        expect(PRICING_COPY.pricePerSeatPer("year")).toBe("per seat, per year");
    });

    it("points to the contact page wherever it mentions contacting the operator", () => {
        for (const sentence of [PRICING_COPY.billingOff, PRICING_COPY.unavailableContact]) {
            expect(sentence.href).toBe(CONTACT_PATH);
            expect(sentence.link).toBe("contact the operator");
            const whole = `${sentence.before}${sentence.link}${sentence.after}`;
            expect(whole.endsWith(".")).toBe(true);
            expect(whole).not.toMatch(/\s{2,}/);
        }
    });
});

describe("contact page copy", () => {
    it("builds its one action from the brand's support mailbox, with the subject filled in", () => {
        const mailto = contactMailto();
        expect(mailto.startsWith(`mailto:${brand.supportEmail}?subject=`)).toBe(true);
        const subject = decodeURIComponent(mailto.split("?subject=")[1]);
        expect(subject).toBe(CONTACT_COPY.subject);
        expect(subject).toContain(brand.productName);
        // Mail programs show a "+" literally, so spaces are percent-encoded.
        expect(mailto).not.toContain("+");
        expect(mailto).not.toMatch(/\s/);
    });

    it("says a person replies by email and promises nothing about when", () => {
        expect(CONTACT_COPY.lede).toMatch(/a person reads it and replies by email/i);
        // No reply time unless the operator writes one.
        expect(CONTACT_COPY.responseNote).toBeNull();
        const { responseNote, ...copy } = CONTACT_COPY;
        void responseNote;
        const text = JSON.stringify(copy);
        expect(text).not.toMatch(/\d/);
        expect(text).not.toMatch(
            /\b(?:within|hours?|minutes?|business days?|working days?|same day|immediately|promptly|shortly|soon|asap|demo|demonstration|call back|schedule|book)\b/i,
        );
    });

    it("says what to include, what to leave out and where to look first", () => {
        expect(CONTACT_COPY.include.length).toBeGreaterThan(1);
        expect(CONTACT_COPY.leaveOut).toMatch(/client documents/i);
        expect(CONTACT_COPY.pointers.map((pointer) => pointer.href)).toEqual([
            "/security",
            "/pricing",
        ]);
    });
});

describe("the frame around the public pages", () => {
    it("links the footer to contact, security, terms, privacy and source, in that order", () => {
        expect(Object.keys(SITE_CHROME_COPY.footer)).toEqual([
            "contact",
            "security",
            "terms",
            "privacy",
            "source",
            "attributions",
        ]);
        expect(CONTACT_PATH).toBe("/contact");
    });

    it("keeps the header to the three public pages", () => {
        expect(SITE_CHROME_COPY.nav.map((item) => item.href)).toEqual([
            "/pricing",
            "/docs",
            "/security",
        ]);
    });
});
