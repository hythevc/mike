// SPDX-License-Identifier: AGPL-3.0-only
// Tests for scripts/brand-sweep.mjs: what counts as a legacy-brand hit, what
// the allowlist keeps out, the per-application baselines and the gate.
//
// Run: node --test scripts/brand-sweep.test.mjs

import { deepStrictEqual, match, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    APPS,
    BASELINE_DIR,
    PATTERNS,
    REPO_ROOT,
    countHits,
    scriptComments,
    sweepApp,
    sweepText,
} from "./brand-sweep.mjs";

const SWEEP = join(dirname(fileURLToPath(import.meta.url)), "brand-sweep.mjs");
const run = (...args) => spawnSync(process.execPath, [SWEEP, ...args], { encoding: "utf8" });

const temporary = [];
after(() => {
    for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});
function scratch(prefix) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temporary.push(dir);
    return dir;
}
function checkout(files) {
    const root = scratch("brand-sweep-");
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), text);
    }
    return root;
}
const patternsOf = (hits) => hits.map((hit) => hit.pattern);
const zero = Object.fromEntries(PATTERNS.map(({ id }) => [id, 0]));

// A web app file with one example of everything the sweep has to tell apart.
const PAGE = `// Mike in a line comment is not counted.
/* Nor in a block comment: Mike, MikeOSS, mikeoss.com. */
/**
 * Nor in JSDoc: Mike.
 */
import { brand } from "@mike/brand";
import { other } from "@mike/model-catalog";

export const title = "Mike - Legal AI";
export const Logo = () => <span className="logo">Mike</span>;
export const Note = () => <p>Don't ask Mike twice.</p>;
export const Hidden = () => <div>{/* Mike in a JSX comment */}</div>;
export const credit = "Based on Mike by Open-Legal-Products, AGPL-3.0";
const cookie = "__Host-mike-session";
const pkce = "mike-session-code-verifier";
const handoff = "mike-auth-handoff-v1";
const manifest = "mike-project-manifest-v1";
localStorage.setItem("mike.activeWorkspace.u1", "x");
localStorage.setItem("mike:quickActions", "x");
const table = "mike_workflows";
const site = "https://mikeoss.com/terms";
const support = "mailto:will@mikeoss.com?subject=Help";
const escaped = /^mailto:will@mikeoss\\.com\\?/;
const urls = /https?:\\/\\/[^\\s"'<>]+/g; // Mike after a regex is a comment
const ratio = total / 2; // Mike after a division is a comment
const label = \`Mike \${user.name} // not a comment\`;
const nested = \`\${\`inner \${"Mike"}\`} done\`; // Mike
const dsn = "https://k@o4512288166510592.ingest.us.sentry.io/1";
download("mike-chat-export.json");
download(\`mike-\${kind}-export-\${id.slice(0, 8)}.json\`);
const fork = "MikeOSS";
const apiTag = "mike-api";
`;

describe("what is counted", () => {
    test("user-facing strings and JSX text count; comments, attribution and persisted identifiers do not", () => {
        const hits = sweepText("frontend/src/page.tsx", PAGE);
        const lines = (pattern) => hits.filter((hit) => hit.pattern === pattern).map((hit) => hit.line);
        deepStrictEqual(lines("name"), [9, 10, 11, 26, 27]);
        deepStrictEqual(lines("domain"), [21]);
        deepStrictEqual(lines("supportAddress"), [22, 23]);
        deepStrictEqual(lines("sentryOrg"), [28]);
        deepStrictEqual(lines("fileName"), [29, 30]);
        deepStrictEqual(lines("ossName"), [31]);
        deepStrictEqual(countHits(hits).total, 12);
        // Exact positions, for --list.
        deepStrictEqual(hits[0], { file: "frontend/src/page.tsx", line: 9, column: 23, pattern: "name", text: "Mike" });
    });

    test("the allowlisted persisted identifiers are never counted, even all together", () => {
        const identifiers = [
            "__Host-mike-session",
            "mike-session.0",
            "mike-session-code-verifier",
            "mike-auth-handoff-v1",
            "mike-project-manifest-v1",
            "mike.activeWorkspace.user-1",
            "mike:quickActions",
            "mike_workflows",
            "@mike/brand",
            "@mike/contracts",
        ];
        const text = identifiers.map((id) => `export const x${id.length} = "${id}";`).join("\n");
        deepStrictEqual(sweepText("backend/src/keys.ts", text), []);
    });

    test("each file type's own comment syntax is honoured", () => {
        deepStrictEqual(patternsOf(sweepText("a.css", "/* Mike */\n.x::after { content: \"Mike\"; }\n")), ["name"]);
        deepStrictEqual(
            patternsOf(sweepText("a.html", "<!-- Mike -->\n<title>MikeOSS</title>\n<p>Mike</p>\n")),
            ["ossName", "name"],
        );
        deepStrictEqual(patternsOf(sweepText("a.sql", "-- Mike\nselect 'Mike';\n/* Mike */\n")), ["name"]);
        deepStrictEqual(patternsOf(sweepText("a.yml", "# Mike\nname: Mike # Mike\n")), ["name"]);
        deepStrictEqual(patternsOf(sweepText("a.json", '{ "title": "Mike" }\n')), ["name"]);
        deepStrictEqual(sweepText("font.woff2", "Mike"), []);
    });

    test("identifiers that merely contain the name are not the name", () => {
        const text = 'class MikeApiError {}\nconst mikeApi = 1;\n<MikeIcon />\nconst css = "--mike-docx-focus-color";\n';
        deepStrictEqual(sweepText("a.tsx", text), []);
    });

    test("comment ranges survive strings, regexes and templates that look like comments", () => {
        const text = 'const a = "// x"; const b = /\\/*/; const c = `/* ${"//"} */`; // real\n/* real */';
        const ranges = scriptComments(text).map(([start, end]) => text.slice(start, end));
        deepStrictEqual(ranges, ["// real", "/* real */"]);
    });

    test("an apostrophe in JSX text affects at most its own line", () => {
        const text = "<p>It's here</p>\n// Mike\nconst t = 'Mike';\n";
        deepStrictEqual(sweepText("a.tsx", text).map((hit) => hit.line), [3]);
    });

    test("a URL in JSX text is not a comment", () => {
        deepStrictEqual(patternsOf(sweepText("a.tsx", "<a>https://mikeoss.com</a>\n")), ["domain"]);
    });
});

describe("applications and baselines", () => {
    const fixture = () =>
        checkout({
            "frontend/src/app/page.tsx": PAGE,
            "frontend/src/shared/brand.generated.ts": 'export const brand = { upstreamAttribution: { projectName: "Mike" } };\n',
            "frontend/src/app/fonts/x.woff2": "Mike",
            "backend/src/lib/prompts.ts": "export const SYSTEM = `You are Mike, an assistant.`;\n",
            "backend/src/lib/brand.generated.ts": 'export const brand = { notice: "Mike" };\n',
            "word-addin/src/taskpane/index.html": "<!doctype html>\n<!-- Mike -->\n<title>MikeOSS</title>\n",
            "desktop/src/main.js": 'const title = "Mike";\n',
        });

    test("each application counts only its own source, and generated brand modules are skipped", () => {
        const root = fixture();
        strictEqual(countHits(sweepApp("frontend", root)).total, 12);
        deepStrictEqual(countHits(sweepApp("backend", root)).counts, { ...zero, name: 1 });
        deepStrictEqual(countHits(sweepApp("word-addin", root)).counts, { ...zero, ossName: 1 });
    });

    test("--write-baselines writes one file per application, and the gate holds them", () => {
        const root = fixture();
        const written = run("--root", root, "--write-baselines");
        strictEqual(written.status, 0, written.stderr);
        for (const app of Object.keys(APPS)) {
            const baseline = JSON.parse(readFileSync(join(root, BASELINE_DIR, `${app}.json`), "utf8"));
            strictEqual(baseline.app, app);
            deepStrictEqual(baseline.roots, APPS[app]);
            match(baseline.$comment, /^SPDX-License-Identifier: AGPL-3\.0-only\./);
        }
        const gate = run("--root", root);
        strictEqual(gate.status, 0, gate.stderr);
        match(gate.stdout, /No legacy-brand count rose above its baseline/);
    });

    test("the gate fails when a count rises, naming the application and the pattern", () => {
        const root = fixture();
        strictEqual(run("--root", root, "--write-baselines").status, 0);
        writeFileSync(join(root, "backend/src/lib/new.ts"), 'export const hello = "Ask Mike";\n');
        const gate = run("--root", root);
        strictEqual(gate.status, 1);
        match(gate.stderr, /backend: name rose from 1 to 2/);
    });

    test("the gate passes when counts fall, and says how to record it", () => {
        const root = fixture();
        strictEqual(run("--root", root, "--write-baselines").status, 0);
        writeFileSync(join(root, "backend/src/lib/prompts.ts"), "export const SYSTEM = `You are an assistant.`;\n");
        const gate = run("--root", root);
        strictEqual(gate.status, 0, gate.stderr);
        match(gate.stdout, /lower: backend: name fell from 1 to 0; run --write-baselines/);
    });

    test("a missing baseline fails the gate", () => {
        const root = fixture();
        const gate = run("--root", root);
        strictEqual(gate.status, 1);
        match(gate.stderr, /frontend: no baseline at scripts\/brand-sweep\/frontend\.json/);
    });

    test("--list prints every hit with its location", () => {
        const root = fixture();
        const listed = run("--root", root, "--list", "backend", "word-addin");
        strictEqual(listed.status, 0, listed.stderr);
        deepStrictEqual(listed.stdout.trim().split("\n"), [
            "backend/src/lib/prompts.ts:1:32\tname\tMike",
            "word-addin/src/taskpane/index.html:3:8\tossName\tMikeOSS",
        ]);
        strictEqual(run("--root", root, "--list", "desktop").status, 1);
    });
});

describe("this repository", () => {
    test("a run on the repository writes the three per-application baselines", () => {
        const out = scratch("brand-sweep-baselines-");
        const written = run("--write-baselines", "--baselines", out);
        strictEqual(written.status, 0, written.stderr);
        for (const app of Object.keys(APPS)) {
            const file = join(out, `${app}.json`);
            ok(existsSync(file), `${file} was not written`);
            const baseline = JSON.parse(readFileSync(file, "utf8"));
            deepStrictEqual(Object.keys(baseline.counts), PATTERNS.map(({ id }) => id));
            strictEqual(
                baseline.total,
                Object.values(baseline.counts).reduce((sum, n) => sum + n, 0),
            );
            // The committed baseline is the ratchet: today's count may be lower, never higher.
            const committed = JSON.parse(readFileSync(join(REPO_ROOT, BASELINE_DIR, `${app}.json`), "utf8"));
            for (const { id } of PATTERNS) {
                ok(baseline.counts[id] <= committed.counts[id], `${app}: ${id} ${baseline.counts[id]} > ${committed.counts[id]}`);
            }
        }
    });

    test("the upstream Sentry organisation is gone from every application", () => {
        for (const app of Object.keys(APPS)) {
            deepStrictEqual(sweepApp(app).filter((hit) => hit.pattern === "sentryOrg"), [], app);
        }
    });

    test("the gate passes on the repository", () => {
        const gate = run();
        strictEqual(gate.status, 0, gate.stderr);
    });
});
