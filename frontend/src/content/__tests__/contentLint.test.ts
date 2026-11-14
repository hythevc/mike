// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Content lint. Scans the legal content, README.md, the *Labels.ts files and
// the playbook summary export for over-claims and missing disclaimers:
//
//   - prohibited marketing phrases ("AI lawyer", "robot lawyer", "replaces
//     lawyers", "guaranteed", "100% accurate", "verified accuracy");
//   - a percentage accuracy or time-saving claim with no substantiation id;
//   - a content page (a Markdown file under src/content) that does not carry
//     the "legal information, not legal advice" line.
//
// The public copy (the site and documentation content, and the public request
// form's labels) is held to a second, stricter set of rules, applied to the
// words a visitor reads rather than to the source around them:
//
//   - banned vocabulary: words that claim without saying anything;
//   - exclamation marks;
//   - any percentage, or an "N times faster" figure, with no substantiation id;
//   - customer claims (who trusts or uses the product, how many, testimonials);
//   - certification claims (a named framework, or "certified", "audited" and
//     the like in a sentence that does not say it has not happened).
//
// The lint logic lives in this test file so its own phrase patterns are not
// scanned as content. The negative cases prove each rule actually fires.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CONTACT_COPY } from "../site/contact";
import { PRICING_COPY } from "../site/pricing";
import {
    securityFactLine,
    securityFacts,
    trustStripFacts,
    type SecurityFact,
} from "../site/securityFacts";

const contentDir = path.resolve(__dirname, "..");
const frontendRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(frontendRoot, "..");
const componentsDir = path.join(frontendRoot, "src", "app", "components");

interface Target {
    /** Repo-relative path, for messages. */
    label: string;
    absolute: string;
    /** A content page carries the disclaimer; other files are phrase-only. */
    isContentPage: boolean;
}

function walk(dir: string, match: (file: string) => boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "__tests__" || entry === "node_modules") continue;
            out.push(...walk(full, match));
        } else if (match(full)) {
            out.push(full);
        }
    }
    return out;
}

function collectTargets(): Target[] {
    const rel = (abs: string) => path.relative(repoRoot, abs);
    const targets: Target[] = [];

    // 1. Everything under src/content (Markdown and TypeScript), minus tests.
    for (const file of walk(
        contentDir,
        (f) => f.endsWith(".md") || f.endsWith(".ts"),
    )) {
        if (/\.test\.ts$/.test(file)) continue;
        targets.push({
            label: rel(file),
            absolute: file,
            isContentPage: file.endsWith(".md"),
        });
    }

    // 2. README.md at the repository root.
    targets.push({
        label: "README.md",
        absolute: path.join(repoRoot, "README.md"),
        isContentPage: false,
    });

    // 3. Every *Labels.ts file under the web components.
    for (const file of walk(componentsDir, (f) => f.endsWith("Labels.ts"))) {
        targets.push({ label: rel(file), absolute: file, isContentPage: false });
    }

    // 4. The playbook summary export (its DOCX labels, draft label and
    //    disclaimer), which a wave-1 follow-up asked W20 to lint.
    targets.push({
        label: "backend/src/modules/playbooks/playbooks.summaryExport.ts",
        absolute: path.join(
            repoRoot,
            "backend/src/modules/playbooks/playbooks.summaryExport.ts",
        ),
        isContentPage: false,
    });

    return targets;
}

const PROHIBITED: { label: string; pattern: RegExp }[] = [
    { label: "AI lawyer", pattern: /\bai[\s-]?lawyer\b/i },
    { label: "robot lawyer", pattern: /\brobot[\s-]?lawyer\b/i },
    { label: "replaces lawyers", pattern: /\breplaces\s+lawyers\b/i },
    { label: "guaranteed", pattern: /\bguaranteed\b/i },
    { label: "100% accurate", pattern: /\b100\s*(?:%|percent)\s*accurate\b/i },
    { label: "verified accuracy", pattern: /\bverified\s+accuracy\b/i },
];

const PERCENTAGE = /\b\d{1,3}(?:\.\d+)?\s*(?:%|percent\b)/i;
const CLAIM_CONTEXT =
    /\b(accuracy|accurate|faster|quicker|time|hours?|minutes?|days|weeks|productivity|efficien\w*|speed|saves?|saved|saving|reduces?|reduction)\b/i;
const SUBSTANTIATION = /\[subst:[\w.-]+\]/i;
const DISCLAIMER = /legal information,?\s+not legal advice/i;

/** Every policy violation in `text`, as human-readable strings. */
function lintText(label: string, text: string, isContentPage: boolean): string[] {
    const violations: string[] = [];
    const lines = text.split("\n");

    lines.forEach((line, index) => {
        const lineNo = index + 1;
        for (const rule of PROHIBITED) {
            if (rule.pattern.test(line)) {
                violations.push(
                    `${label}:${lineNo} prohibited phrase "${rule.label}"`,
                );
            }
        }
        if (
            PERCENTAGE.test(line) &&
            CLAIM_CONTEXT.test(line) &&
            !SUBSTANTIATION.test(line)
        ) {
            violations.push(
                `${label}:${lineNo} percentage accuracy or time-saving claim without a substantiation id`,
            );
        }
    });

    if (isContentPage && !DISCLAIMER.test(text)) {
        violations.push(
            `${label} is a content page missing the "legal information, not legal advice" line`,
        );
    }
    return violations;
}

// ---------------------------------------------------------------------------
// Public copy: the stricter rules
// ---------------------------------------------------------------------------

/**
 * The files whose words a signed-out visitor reads: everything under
 * content/site and content/docs, and the label modules of public pages. A
 * later change that adds a public label module adds it to the list below.
 */
const PUBLIC_COPY_DIRS = [path.join(contentDir, "site"), path.join(contentDir, "docs")];
const PUBLIC_COPY_LABEL_MODULES = [
    path.join(componentsDir, "intake", "requestFormLabels.ts"),
];

function collectPublicCopyTargets(): { label: string; absolute: string }[] {
    const rel = (abs: string) => path.relative(repoRoot, abs);
    const files = [
        ...PUBLIC_COPY_DIRS.flatMap((dir) =>
            walk(dir, (f) => f.endsWith(".md") || f.endsWith(".ts")),
        ),
        ...PUBLIC_COPY_LABEL_MODULES,
    ].filter((file) => !/\.test\.ts$/.test(file));
    return files.map((file) => ({ label: rel(file), absolute: file }));
}

/** Words that claim without saying anything. Matched as whole words. */
const BANNED_VOCABULARY: { label: string; pattern: RegExp }[] = [
    { label: "seamless", pattern: /\bseamless(?:ly)?\b/i },
    { label: "powerful", pattern: /\bpowerful(?:ly)?\b/i },
    { label: "unlock", pattern: /\bunlock(?:s|ed|ing)?\b/i },
    { label: "elevate", pattern: /\belevat(?:e|es|ed|ing)\b/i },
    { label: "effortless", pattern: /\beffortless(?:ly)?\b/i },
    { label: "revolutionary", pattern: /\brevolution(?:ary|i[sz]e[sd]?|i[sz]ing)\b/i },
    { label: "cutting-edge", pattern: /\bcutting[\s-]edge\b/i },
    { label: "next-generation", pattern: /\bnext[\s-]gen(?:eration)?\b/i },
    { label: "game-changing", pattern: /\bgame[\s-]chang(?:er|ers|ing)\b/i },
    { label: "supercharge", pattern: /\bsupercharg(?:e|es|ed|ing)\b/i },
    { label: "world-class", pattern: /\bworld[\s-]class\b/i },
    { label: "industry-leading", pattern: /\bindustry[\s-]leading\b/i },
    { label: "best-in-class", pattern: /\bbest[\s-]in[\s-]class\b/i },
    { label: "state-of-the-art", pattern: /\bstate[\s-]of[\s-]the[\s-]art\b/i },
    { label: "AI-powered", pattern: /\bai[\s-]powered\b/i },
    { label: "empower", pattern: /\bempower(?:s|ed|ing)?\b/i },
    { label: "delve", pattern: /\bdelv(?:e|es|ed|ing)\b/i },
    { label: "transformative", pattern: /\btransformative\b/i },
    { label: "intelligent", pattern: /\bintelligent(?:ly)?\b/i },
    { label: "ultimate", pattern: /\bultimate\b/i },
    { label: "unparalleled", pattern: /\b(?:unparalleled|unrivall?ed|unmatched)\b/i },
    { label: "the power of", pattern: /\bthe power of\b/i },
    { label: "lightning fast", pattern: /\b(?:lightning|blazing(?:ly)?)[\s-]fast\b/i },
];

const ANY_PERCENTAGE = /\d(?:[\d.,]*\d)?\s*(?:%|percent\b)/i;
const MULTIPLIER_CLAIM =
    /\b\d+(?:\.\d+)?\s*(?:x|×|times)\s+(?:as\s+)?(?:faster|quicker|more|better|cheaper)\b/i;

/** Who uses or trusts the product, how many of them, and what they said. */
const CUSTOMER_CLAIMS: RegExp[] = [
    /\b(?:trusted|loved|chosen|preferred|relied on)\s+by\b/i,
    /\bused by\s+(?:leading|top|over|more than|thousands|hundreds|millions|\d)/i,
    /\b(?:thousands|hundreds|millions)\s+of\s+(?:customers|law firms|firms|lawyers|legal teams|teams|users|organi[sz]ations|companies|clients)\b/i,
    /\b\d[\d,.]*\s*(?:k|m)?\+?\s+(?:customers|law firms|firms|lawyers|legal teams|teams|users|organi[sz]ations|companies)\b/i,
    /\bcustomers include\b/i,
    /\bour (?:customers|clients) (?:include|say|love|trust)\b/i,
    /\btestimonials?\b/i,
    /\bcase stud(?:y|ies)\b/i,
    /\bas (?:seen|featured) (?:in|on)\b/i,
    /\baward[\s-]winning\b/i,
    /#1\b/,
];

/** A framework named as if it had been met. */
const NAMED_FRAMEWORK =
    /\b(?:SOC\s?[123]|ISO(?:\/IEC)?\s?27\d{3}|HIPAA|FedRAMP|PCI[\s-]DSS|Cyber Essentials|TISAX)\b/i;
/** A claim that somebody checked: fine only in a sentence that says nobody has. */
const CERTIFICATION_WORD =
    /\b(?:certified|accredited|attested|audited|compliant|pen(?:etration)?[\s-]tested)\b/i;
const GRADE_CLAIM = /\b(?:bank|military|enterprise|government)[\s-]grade\b/i;
const NEGATION =
    /\b(?:no|not|never|none|nor|neither|without|cannot|until)\b|n['’]t\b/i;

/** One piece of copy and the line it starts on. */
interface CopySegment {
    line: number;
    text: string;
}

/**
 * The words of a file a reader sees. For Markdown: every line, with HTML
 * comments blanked. For TypeScript: the text of every string and template
 * literal, so punctuation in code and words in comments are not copy; import
 * and export paths are left out.
 */
function copySegments(text: string, kind: "md" | "ts"): CopySegment[] {
    if (kind === "md") {
        const visible = text.replace(/<!--[\s\S]*?-->/g, (comment) =>
            comment.replace(/[^\n]/g, " "),
        );
        return visible
            .split("\n")
            .map((line, index) => ({ line: index + 1, text: line }))
            .filter((segment) => segment.text.trim() !== "");
    }
    const source = ts.createSourceFile("copy.ts", text, ts.ScriptTarget.Latest, true);
    const segments: CopySegment[] = [];
    const visit = (node: ts.Node) => {
        const isLiteral =
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node);
        const isModulePath =
            ts.isStringLiteral(node) &&
            (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
        if (isLiteral && !isModulePath && node.text.trim() !== "") {
            segments.push({
                line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                text: node.text,
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return segments;
}

/** Every violation of the public-copy rules in `text`. */
function lintPublicCopy(label: string, text: string, kind: "md" | "ts"): string[] {
    const violations: string[] = [];
    for (const segment of copySegments(text, kind)) {
        const where = `${label}:${segment.line}`;
        // In Markdown a "!" in front of "[" starts an image, not a sentence.
        const prose = kind === "md" ? segment.text.replace(/!\[/g, "[") : segment.text;

        for (const rule of BANNED_VOCABULARY) {
            if (rule.pattern.test(prose)) {
                violations.push(`${where} banned vocabulary "${rule.label}"`);
            }
        }
        if (prose.includes("!")) {
            violations.push(`${where} exclamation mark`);
        }
        // A substantiation id names the evidence for a figure or an
        // assessment stated in the same line or string.
        const substantiated = SUBSTANTIATION.test(prose);
        if (
            (ANY_PERCENTAGE.test(prose) || MULTIPLIER_CLAIM.test(prose)) &&
            !substantiated
        ) {
            violations.push(`${where} figure without a substantiation id`);
        }
        if (CUSTOMER_CLAIMS.some((pattern) => pattern.test(prose))) {
            violations.push(`${where} customer claim`);
        }
        if (GRADE_CLAIM.test(prose)) {
            violations.push(`${where} certification claim`);
        }
        // A sentence at a time, so "not certified" in one sentence does not
        // excuse "certified" in the next.
        for (const sentence of prose.split(/(?<=[.?;])\s+/)) {
            const claims =
                NAMED_FRAMEWORK.test(sentence) || CERTIFICATION_WORD.test(sentence);
            if (claims && !NEGATION.test(sentence) && !substantiated) {
                violations.push(`${where} certification claim`);
            }
        }
    }
    return violations;
}

const kindOf = (file: string): "md" | "ts" => (file.endsWith(".md") ? "md" : "ts");

describe("content lint passes on the real content", () => {
    const targets = collectTargets();

    it("finds the files it should be checking", () => {
        // the 9 legal templates + the registry, README, 2 label files, export
        expect(targets.length).toBeGreaterThanOrEqual(13);
        expect(targets.some((t) => t.label.endsWith("terms.md"))).toBe(true);
        expect(targets.some((t) => t.label === "README.md")).toBe(true);
        expect(
            targets.some((t) => t.label.endsWith("decisionLabels.ts")),
        ).toBe(true);
        expect(
            targets.some((t) =>
                t.label.endsWith("playbooks.summaryExport.ts"),
            ),
        ).toBe(true);
    });

    it("reports no violations", () => {
        const violations = targets.flatMap((t) =>
            lintText(t.label, readFileSync(t.absolute, "utf8"), t.isContentPage),
        );
        expect(violations).toEqual([]);
    });

    it("every legal content page carries the disclaimer", () => {
        const pages = targets.filter((t) => t.isContentPage);
        expect(pages.length).toBeGreaterThanOrEqual(9);
        for (const page of pages) {
            expect(
                DISCLAIMER.test(readFileSync(page.absolute, "utf8")),
                `${page.label} must carry the disclaimer`,
            ).toBe(true);
        }
    });
});

describe("content lint fails on bad fixtures", () => {
    it("flags a prohibited phrase", () => {
        const v = lintText("fixture.md", "Try our AI lawyer today.", false);
        expect(v.some((m) => m.includes('"AI lawyer"'))).toBe(true);
    });

    it("flags each listed prohibited phrase", () => {
        for (const sample of [
            "a robot lawyer",
            "it replaces lawyers",
            "results are guaranteed",
            "it is 100% accurate",
            "we offer verified accuracy",
        ]) {
            expect(lintText("f", sample, false).length).toBeGreaterThan(0);
        }
    });

    it("flags a percentage time-saving claim with no substantiation id", () => {
        const v = lintText("fixture.md", "This saves 40% of review time.", false);
        expect(
            v.some((m) => m.includes("without a substantiation id")),
        ).toBe(true);
    });

    it("allows a percentage claim that carries a substantiation id", () => {
        const v = lintText(
            "fixture.md",
            "This saves 40% of review time. [subst:bench-2026-01]",
            false,
        );
        expect(v).toEqual([]);
    });

    it("flags a content page missing the disclaimer", () => {
        const v = lintText(
            "fixture.md",
            "# Terms\n\nNo disclaimer here.",
            true,
        );
        expect(
            v.some((m) => m.includes("missing the")),
        ).toBe(true);
    });

    it("does not treat a non-content file as missing the disclaimer", () => {
        expect(lintText("labels.ts", "export const x = 1;", false)).toEqual([]);
    });
});

describe("public copy lint passes on the real copy", () => {
    const targets = collectPublicCopyTargets();
    const labels = targets.map((target) => target.label);

    it("covers the site copy, the documentation and the request form's labels", () => {
        for (const file of [
            "content/site/home.ts",
            "content/site/pricing.ts",
            "content/site/contact.ts",
            "content/site/chrome.ts",
            "content/site/securityFacts.ts",
            "content/site/placeholders.ts",
            "content/site/security.md",
            "content/docs/getting-started.md",
            "components/intake/requestFormLabels.ts",
        ]) {
            expect(
                labels.some((label) => label.endsWith(file)),
                `${file} must be scanned`,
            ).toBe(true);
        }
        // No test file is scanned as copy.
        expect(labels.some((label) => label.includes("__tests__"))).toBe(false);
    });

    it("reports no violations", () => {
        const violations = targets.flatMap((target) =>
            lintPublicCopy(
                target.label,
                readFileSync(target.absolute, "utf8"),
                kindOf(target.absolute),
            ),
        );
        expect(violations).toEqual([]);
    });

    it("reads the contact page's copy and finds every sentence of it", () => {
        // The lint works on string literals; this proves it sees the contact
        // copy rather than passing because it found nothing to read.
        const file = targets.find((target) => target.label.endsWith("site/contact.ts"))!;
        const read = copySegments(readFileSync(file.absolute, "utf8"), "ts").map(
            (segment) => segment.text,
        );
        for (const sentence of [
            CONTACT_COPY.title,
            CONTACT_COPY.lede,
            CONTACT_COPY.action,
            CONTACT_COPY.includeHeading,
            ...CONTACT_COPY.include,
            CONTACT_COPY.leaveOut,
            CONTACT_COPY.pointersHeading,
            ...CONTACT_COPY.pointers.map((pointer) => pointer.note),
        ]) {
            expect(read, sentence).toContain(sentence);
        }
    });

    it("passes the facts under the pricing action as a visitor reads them", () => {
        // Checked as rendered, so the words the page adds to a fact that is
        // not in place yet ("Planned for ...") are held to the same rules.
        const planned: SecurityFact = {
            id: "example-planned",
            status: "planned",
            date: "2099-01",
            text: "An example fact that is not in place yet.",
        };
        const shown = [
            PRICING_COPY.trustHeading,
            PRICING_COPY.trustLink,
            ...trustStripFacts().map(securityFactLine),
            ...securityFacts().map(securityFactLine),
            securityFactLine(planned),
        ];
        expect(shown.length).toBeGreaterThan(4);
        expect(lintPublicCopy("pricing strip", shown.join("\n"), "md")).toEqual([]);
    });
});

describe("public copy lint fails on bad fixtures", () => {
    const md = (text: string) => lintPublicCopy("fixture.md", text, "md");
    const tsCopy = (text: string) => lintPublicCopy("fixture.ts", text, "ts");

    it.each([
        ["seamless", "A seamless way to review contracts."],
        ["powerful", "Powerful review tools for every team."],
        ["unlock", "Unlock the value in your documents."],
        ["elevate", "Elevate your practice."],
        ["effortless", "Effortless contract review."],
    ])('flags the banned word "%s"', (word, sentence) => {
        expect(md(sentence)).toEqual([`fixture.md:1 banned vocabulary "${word}"`]);
        expect(tsCopy(`export const line = "${sentence}";`)).toEqual([
            `fixture.ts:1 banned vocabulary "${word}"`,
        ]);
    });

    it("flags the rest of the banned vocabulary", () => {
        for (const sentence of [
            "A revolutionary assistant.",
            "Cutting-edge models.",
            "The next generation of review.",
            "A game-changing workflow.",
            "Supercharge your team.",
            "World-class security.",
            "Industry-leading accuracy.",
            "Best-in-class drafting.",
            "State-of-the-art models.",
            "AI-powered review.",
            "Empower your lawyers.",
            "Delve into every clause.",
            "A transformative tool.",
            "An intelligent assistant.",
            "The ultimate legal workspace.",
            "Unparalleled speed.",
            "Harness the power of AI.",
            "Lightning-fast answers.",
        ]) {
            expect(
                md(sentence).some((violation) => violation.includes("banned vocabulary")),
                sentence,
            ).toBe(true);
        }
    });

    it("does not mistake a longer word for a banned one", () => {
        expect(md("Ultimately a lawyer decides.")).toEqual([]);
        expect(md("The elevator is out of order.")).toEqual([]);
        expect(md("Artificial intelligence is used on request.")).toEqual([]);
    });

    it("flags an exclamation mark", () => {
        expect(md("Create an account today!")).toEqual(["fixture.md:1 exclamation mark"]);
        expect(tsCopy('export const cta = "Start now!";')).toEqual([
            "fixture.ts:1 exclamation mark",
        ]);
        expect(tsCopy("export const cta = `Welcome, ${name}!`;")).toEqual([
            "fixture.ts:1 exclamation mark",
        ]);
    });

    it("reads copy, not code: operators, comments, paths and images are not exclamations", () => {
        const source = [
            "// Never shout! Not even in a comment about powerful words.",
            'import { brand } from "@/shared/brand.generated";',
            "const pattern = /^[^!]+$/;",
            "export function label(value?: string) {",
            "    if (!value || value !== brand.productName) return null;",
            "    return value!.trim();",
            "}",
        ].join("\n");
        expect(tsCopy(source)).toEqual([]);
        expect(md("<!-- SPDX-License-Identifier: AGPL-3.0-only -->\n\n![A diagram](diagram.svg)")).toEqual(
            [],
        );
    });

    it("reports the line a violation is on", () => {
        const source = ['export const ok = "Plain words.";', "", 'export const bad = "Seamless.";'].join(
            "\n",
        );
        expect(tsCopy(source)).toEqual(['fixture.ts:3 banned vocabulary "seamless"']);
        expect(md("Plain words.\n\nSeamless.")).toEqual(['fixture.md:3 banned vocabulary "seamless"']);
    });

    it("flags a percentage or a multiple with no substantiation id", () => {
        for (const sentence of [
            "Review 40% more contracts.",
            "Quotes are found 95 percent of the time.",
            "Uptime of 99.9%.",
            "Drafting is 3x faster.",
            "Review is 10 times quicker.",
        ]) {
            expect(md(sentence), sentence).toEqual([
                "fixture.md:1 figure without a substantiation id",
            ]);
        }
    });

    it("allows a figure that carries a substantiation id, and plain counts", () => {
        expect(md("Quotes were found in 95% of answers. [subst:quote-bench-2027-01]")).toEqual([]);
        expect(md("Up to 2,000 events per export.")).toEqual([]);
        expect(md("Requests are deleted after 365 days.")).toEqual([]);
    });

    it("flags an invented customer claim", () => {
        for (const sentence of [
            "Trusted by law firms everywhere.",
            "Loved by in-house teams.",
            "Used by leading firms.",
            "Used by over a hundred teams.",
            "Thousands of lawyers rely on it.",
            "Join 500+ firms.",
            "More than 2,000 lawyers have signed up.",
            "Our customers include the largest firms.",
            "Read the testimonials.",
            "See the case study.",
            "As featured in the legal press.",
            "An award-winning assistant.",
            "The #1 legal copilot.",
        ]) {
            expect(md(sentence), sentence).toEqual(["fixture.md:1 customer claim"]);
        }
    });

    it("flags an invented certification claim", () => {
        for (const sentence of [
            "SOC 2 Type II.",
            "We hold ISO 27001.",
            "ISO/IEC 27001 and HIPAA ready.",
            "FedRAMP authorised hosting.",
            "The service is certified.",
            "Independently audited every year.",
            "Fully compliant with every framework.",
            "Penetration-tested by an outside firm.",
            "Bank-grade encryption.",
            "Enterprise-grade security.",
        ]) {
            expect(md(sentence), sentence).toEqual(["fixture.md:1 certification claim"]);
        }
    });

    it("allows saying plainly that no certification exists", () => {
        expect(md("No outside party has certified or audited this service yet.")).toEqual([]);
        expect(md("This service is not SOC 2 certified.")).toEqual([]);
        expect(md("## Independent certification\n\nNo independent certification yet.")).toEqual([]);
    });

    it("does not let a denial in one sentence excuse a claim in the next", () => {
        expect(md("We have not been audited yet. The service is SOC 2 certified.")).toEqual([
            "fixture.md:1 certification claim",
        ]);
    });

    it("allows a recorded assessment that carries a substantiation id", () => {
        expect(md("Penetration-tested in 2027. [subst:pentest-2027-03]")).toEqual([]);
    });
});
