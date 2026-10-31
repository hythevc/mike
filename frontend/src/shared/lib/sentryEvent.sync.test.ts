import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnosticRoute } from "./sentryPrivacy";

/**
 * The redaction core is one privacy control mirrored into two files: the
 * backend cannot import the frontend tree at build time, so it carries a
 * copy. This test is what keeps them one control: it fails the moment the
 * marked block differs, ignoring indentation (2 vs 4 spaces).
 */
const SHARED = path.resolve(__dirname, "sentryEvent.ts");
const BACKEND = path.resolve(
    __dirname,
    "../../../../backend/src/lib/observability/sentry.ts",
);

function sharedBlock(file: string): string {
    const source = readFileSync(file, "utf8");
    const match = source.match(
        /\/\/ BEGIN shared-redaction[\s\S]*?\/\/ END shared-redaction/,
    );
    if (!match) throw new Error(`no shared-redaction block in ${file}`);
    return match[0]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
}

describe("shared-redaction block", () => {
    it("keeps the outbound envelope privacy boundary identical", () => {
        expect(readFileSync(path.resolve(__dirname, "sentryPrivacy.ts"), "utf8"))
            .toBe(readFileSync(path.resolve(__dirname, "../../../../backend/src/lib/observability/sentryPrivacy.ts"), "utf8"));
    });
    it("is identical in the backend and the shared scrubber", () => {
        expect(sharedBlock(BACKEND)).toBe(sharedBlock(SHARED));
    });
});

/**
 * Reporting is off until an operator configures a DSN, so no runtime may
 * carry a destination of its own: a hosted Sentry ingest address in
 * production code (backend, web app or add-in) would be exactly the
 * built-in fallback this rule removed. Test fixtures may use one.
 */
const REPO = path.resolve(__dirname, "../../../..");
const RUNTIME_SOURCES = ["backend/src", "frontend/src", "word-addin/src"];
const isTestOnly = (file: string) =>
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)__tests__\//.test(file);
const BUILT_IN_DESTINATION = /ingest(?:\.[a-z]{2})?\.sentry\.io/i;

function productionFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") out.push(...productionFiles(rel));
        } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !isTestOnly(rel)) {
            out.push(rel);
        }
    }
    return out;
}

it("ships no built-in Sentry destination in any runtime's production code", () => {
    const files = RUNTIME_SOURCES.flatMap(productionFiles);
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.filter((file) =>
        BUILT_IN_DESTINATION.test(readFileSync(path.join(REPO, file), "utf8")),
    );
    expect(offenders).toEqual([]);
});


it('retains the fixed vocabulary of every Express mount without parameter names', () => {
    const app = readFileSync(path.resolve(__dirname, '../../../../backend/src/app.ts'), 'utf8');
    const routes = [...app.matchAll(/app\.(?:use|get)\("([^"]+)"/g)].map(match => match[1]);
    expect(routes.length).toBeGreaterThan(20);
    for (const route of routes) {
        expect(diagnosticRoute(route)).toBe(route.replace(/:[^/]+/g, ':id'));
    }
});
