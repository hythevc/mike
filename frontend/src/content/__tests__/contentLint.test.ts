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
// The lint logic lives in this test file so its own phrase patterns are not
// scanned as content. The negative cases prove each rule actually fires.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
