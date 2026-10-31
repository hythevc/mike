// SPDX-License-Identifier: AGPL-3.0-only
// Legacy-brand sweep.
//
// Counts, per application, the places that still show the upstream
// project's name or addresses, so the rename to the names in
// packages/brand/brand.json can be finished file by file and cannot regress.
// Each application's whole src tree is swept, tests included: a test that
// pins the old copy has to change with it. What is counted (PATTERNS):
//
//   name            the word "Mike" (case-sensitive: lowercase forms are
//                   identifiers, see the allowlist)
//   ossName         "MikeOSS", in any case
//   domain          mikeoss.com, including a regex-escaped mikeoss\.com
//   supportAddress  the upstream support mailbox
//   sentryOrg       the upstream Sentry organisation id
//   fileName        download names that start with "mike-", such as
//                   mike-chat-export.json
//
// What is not counted (the allowlist):
//
//   - comments: // and /* */ in scripts, /* */ in styles, <!-- --> in markup,
//     -- and /* */ in SQL, # in YAML and shell;
//   - attribution text ("<project> by <author>" naming the upstream author)
//     and the generated brand modules, which carry brand.upstreamAttribution;
//   - persisted identifiers, which keep their names on purpose because
//     renaming them signs everyone out or breaks verification of signed
//     exports: the mike-session cookie, mike-auth-handoff-v1,
//     mike-project-manifest-v1, browser storage keys (mike.<key>, mike:<key>),
//     table names (mike_<name>), and @mike/* package and alias names;
//   - desktop/, which is not one of the swept applications.
//
// Baselines are stored per application in scripts/brand-sweep/<app>.json, so
// each rebrand change lowers only its own file. The gate fails when any count
// rises above its baseline.
//
// Usage (from the repository root):
//   node scripts/brand-sweep.mjs                    compare with the baselines; exit 1 if a count rose
//   node scripts/brand-sweep.mjs --write-baselines  record the current counts as the baselines
//   node scripts/brand-sweep.mjs --list [app ...]   print every hit as file:line:column
//   --root <dir>        sweep another checkout (used by the tests)
//   --baselines <dir>   read or write baselines elsewhere (default scripts/brand-sweep)
//
// Dependency-free on purpose: CI runs it before any npm install.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_DIR = "scripts/brand-sweep";

/** The swept applications and the source roots of each. */
export const APPS = {
    frontend: ["frontend/src"],
    backend: ["backend/src"],
    "word-addin": ["word-addin/src"],
};

/**
 * Counted patterns, applied in this order. Each match is blanked before the
 * next pattern runs, so the support mailbox is not also counted as a domain.
 */
export const PATTERNS = [
    { id: "supportAddress", regex: /will@mikeoss\\?\.com/gi },
    { id: "domain", regex: /mikeoss\\?\.com/gi },
    { id: "ossName", regex: /mikeoss/gi },
    { id: "sentryOrg", regex: /o?4512288166510592/g },
    {
        id: "fileName",
        regex: /\bmike-(?:[\w-]|\$\{[^}\n]*\})*\.(?:zip|json|docx|xlsx|pdf|csv|md|txt|html)\b/g,
    },
    { id: "name", regex: /\bMike\b/g },
];

/** Allowlisted text, blanked before anything is counted. */
export const ALLOWED = [
    { id: "attribution", regex: /\bMike(?:OSS)?\s+by\s+Open[- ]Legal[- ]Products\b/gi },
    { id: "sessionCookie", regex: /(?:__Host-)?mike-session[\w.-]*/g },
    { id: "authHandoff", regex: /mike-auth-handoff-v\d+/g },
    { id: "projectManifest", regex: /mike-project-manifest-v\d+/g },
    { id: "storageKey", regex: /\bmike[.:][A-Za-z][\w.:-]*/g },
    { id: "tableName", regex: /\bmike_[a-z0-9_]+/g },
    { id: "packageAlias", regex: /@mike\/[\w-]+/g },
];

/** Generated from brand.json, which holds the upstream attribution. */
const GENERATED = new Set(["brand.generated.ts"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", "coverage", "test-results", "playwright-report"]);

const SCRIPT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const STYLE = new Set([".css", ".scss"]);
const MARKUP = new Set([".html", ".htm", ".xml", ".svg", ".md"]);
const HASH = new Set([".yml", ".yaml", ".sh", ".toml", ".py"]);
const PLAIN = new Set([".json", ".txt"]);

const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_AFTER_WORD = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/** Index after a '...' or "..." string; a string never continues past its line. */
function skipQuoted(text, start, quote) {
    for (let i = start + 1; i < text.length; i += 1) {
        const c = text[i];
        if (c === "\\") i += 1;
        else if (c === quote) return i + 1;
        else if (c === "\n") return i;
    }
    return text.length;
}

/** Index after a regular expression literal, or -1 when `/` is division. */
function skipRegex(text, start) {
    let inClass = false;
    for (let i = start + 1; i < text.length; i += 1) {
        const c = text[i];
        if (c === "\n") return -1;
        if (c === "\\") i += 1;
        else if (inClass) inClass = c !== "]";
        else if (c === "[") inClass = true;
        else if (c === "/") {
            let end = i + 1;
            while (end < text.length && /[a-z]/i.test(text[end])) end += 1;
            return end;
        }
    }
    return -1;
}

/**
 * Template literal text from `start` (just after a backtick or an
 * expression's closing brace): the index after the closing backtick, or
 * after the `${` that opens the next expression.
 */
function skipTemplateText(text, start) {
    for (let i = start; i < text.length; i += 1) {
        const c = text[i];
        if (c === "\\") i += 1;
        else if (c === "`") return { end: i + 1, closed: true };
        else if (c === "$" && text[i + 1] === "{") return { end: i + 2, closed: false };
    }
    return { end: text.length, closed: true };
}

/**
 * Comment ranges in JavaScript or TypeScript. Strings, template literals and
 * regular expression literals are stepped over, so `//` inside them is not a
 * comment. JSX text is not parsed: an apostrophe in it reads as a string that
 * ends with its line, so a misreading never spreads past one line, and a
 * `//` right after a colon (a URL in JSX text) is never a comment.
 */
export function scriptComments(text) {
    const ranges = [];
    const templates = [];
    let depth = 0;
    let last = "";
    let lastWord = "";
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
            const end = text.indexOf("\n", i);
            ranges.push([i, end === -1 ? text.length : end]);
            i = end === -1 ? text.length : end;
        } else if (c === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            ranges.push([i, end === -1 ? text.length : end + 2]);
            i = end === -1 ? text.length : end + 2;
        } else if (c === "'" || c === '"') {
            i = skipQuoted(text, i, c);
            last = ")";
            lastWord = "";
        } else if (c === "`" || (c === "}" && templates.length && depth - 1 === templates[templates.length - 1])) {
            if (c === "}") {
                templates.pop();
                depth -= 1;
            }
            const { end, closed } = skipTemplateText(text, i + 1);
            if (!closed) {
                templates.push(depth);
                depth += 1;
            }
            i = end;
            last = closed ? ")" : "{";
            lastWord = "";
        } else if (c === "/") {
            const end = REGEX_AFTER.has(last) || REGEX_AFTER_WORD.has(lastWord) ? skipRegex(text, i) : -1;
            if (end === -1) {
                last = "/";
                i += 1;
            } else {
                last = ")";
                i = end;
            }
            lastWord = "";
        } else if (/\s/.test(c)) {
            i += 1;
        } else if (/[\w$]/.test(c)) {
            let end = i + 1;
            while (end < text.length && /[\w$]/.test(text[end])) end += 1;
            lastWord = text.slice(i, end);
            last = "a";
            i = end;
        } else {
            if (c === "{") depth += 1;
            else if (c === "}") depth -= 1;
            last = c;
            lastWord = "";
            i += 1;
        }
    }
    return ranges;
}

function delimitedComments(text, open, close) {
    const ranges = [];
    for (let i = text.indexOf(open); i !== -1; i = text.indexOf(open, i)) {
        const end = text.indexOf(close, i + open.length);
        const stop = end === -1 ? text.length : end + close.length;
        ranges.push([i, stop]);
        i = stop;
    }
    return ranges;
}

function lineComments(text, marker) {
    const ranges = [];
    const pattern = marker === "#" ? /(^|\s)#.*$/gm : /--.*$/gm;
    for (const match of text.matchAll(pattern)) {
        const start = match.index + (match[1]?.length ?? 0);
        ranges.push([start, match.index + match[0].length]);
    }
    return ranges;
}

/** Comment ranges for a file, by its extension; null for files not swept. */
export function commentRanges(file, text) {
    const ext = extname(file).toLowerCase();
    if (SCRIPT.has(ext)) return scriptComments(text);
    if (STYLE.has(ext)) return delimitedComments(text, "/*", "*/");
    if (MARKUP.has(ext)) return delimitedComments(text, "<!--", "-->");
    if (ext === ".sql") return [...delimitedComments(text, "/*", "*/"), ...lineComments(text, "--")];
    if (HASH.has(ext)) return lineComments(text, "#");
    if (PLAIN.has(ext)) return [];
    return null;
}

/** 1-based line and column of each index, from the line start offsets. */
function locate(text) {
    const starts = [0];
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    return (index) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (starts[mid] <= index) low = mid;
            else high = mid - 1;
        }
        return { line: low + 1, column: index - starts[low] + 1 };
    };
}

/** Whether a file's type is swept (text formats only). */
export function isSwept(file) {
    const ext = extname(file).toLowerCase();
    return SCRIPT.has(ext) || STYLE.has(ext) || MARKUP.has(ext) || HASH.has(ext) || PLAIN.has(ext) || ext === ".sql";
}

/**
 * Replace ranges with spaces, one per UTF-16 unit and keeping newlines, so
 * every later index, line and column still points into the original text.
 */
function blank(text, ranges) {
    let out = "";
    let cursor = 0;
    for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
        if (end <= cursor) continue;
        const from = Math.max(start, cursor);
        out += text.slice(cursor, from) + text.slice(from, end).replace(/[^\n]/g, " ");
        cursor = end;
    }
    return out + text.slice(cursor);
}

function blankMatches(text, regex) {
    return text.replace(regex, (match) => match.replace(/[^\n]/g, " "));
}

/** Every counted hit in one file's text. Positions are 1-based. */
export function sweepText(file, text) {
    const comments = commentRanges(file, text);
    if (comments === null) return [];
    let visible = blank(text, comments);
    for (const { regex } of ALLOWED) visible = blankMatches(visible, regex);
    const hits = [];
    for (const { id, regex } of PATTERNS) {
        for (const match of visible.matchAll(regex)) {
            hits.push({ pattern: id, index: match.index, text: match[0] });
        }
        visible = blankMatches(visible, regex);
    }
    const position = locate(text);
    return hits
        .sort((a, b) => a.index - b.index)
        .map((hit) => ({ file, ...position(hit.index), pattern: hit.pattern, text: hit.text }));
}

function walk(root, dir, out) {
    let entries;
    try {
        entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) walk(root, rel, out);
        } else if (entry.isFile() && !GENERATED.has(entry.name)) {
            out.push(rel);
        }
    }
    return out;
}

/** All hits for one application under `root`. */
export function sweepApp(app, root = REPO_ROOT) {
    const files = APPS[app].flatMap((dir) => walk(root, dir, [])).filter(isSwept).sort();
    const hits = [];
    for (const file of files) {
        hits.push(...sweepText(file, readFileSync(join(root, file), "utf8")));
    }
    return hits;
}

/** Hit counts per pattern, in PATTERNS order, plus the total. */
export function countHits(hits) {
    const counts = Object.fromEntries(PATTERNS.map(({ id }) => [id, 0]));
    for (const hit of hits) counts[hit.pattern] += 1;
    return { counts, total: hits.length };
}

export function baselineFor(app, hits) {
    const { counts, total } = countHits(hits);
    return {
        $comment:
            `SPDX-License-Identifier: AGPL-3.0-only. Legacy-brand hits in ${APPS[app].join(", ")}, ` +
            "written by `node scripts/brand-sweep.mjs --write-baselines`. CI fails when a count rises " +
            "above this file; lower it in the change that removes hits.",
        app,
        roots: APPS[app],
        counts,
        total,
    };
}

/** Write scripts/brand-sweep/<app>.json for every application. */
export function writeBaselines({ root = REPO_ROOT, baselineDir = join(root, BASELINE_DIR) } = {}) {
    mkdirSync(baselineDir, { recursive: true });
    const written = {};
    for (const app of Object.keys(APPS)) {
        const baseline = baselineFor(app, sweepApp(app, root));
        writeFileSync(join(baselineDir, `${app}.json`), `${JSON.stringify(baseline, null, 2)}\n`);
        written[app] = baseline;
    }
    return written;
}

/**
 * Compare every application's counts with its baseline. Returns the
 * regressions (a count above its baseline, or no baseline at all) and the
 * improvements (a count below it).
 */
export function compareWithBaselines({ root = REPO_ROOT, baselineDir = join(root, BASELINE_DIR) } = {}) {
    const regressions = [];
    const improvements = [];
    const summary = {};
    for (const app of Object.keys(APPS)) {
        const { counts, total } = countHits(sweepApp(app, root));
        summary[app] = { counts, total };
        let baseline;
        try {
            baseline = JSON.parse(readFileSync(join(baselineDir, `${app}.json`), "utf8"));
        } catch {
            regressions.push(`${app}: no baseline at ${relative(root, join(baselineDir, `${app}.json`)).split(sep).join("/")}`);
            continue;
        }
        for (const { id } of PATTERNS) {
            const allowed = Number(baseline.counts?.[id] ?? 0);
            if (counts[id] > allowed) regressions.push(`${app}: ${id} rose from ${allowed} to ${counts[id]}`);
            else if (counts[id] < allowed) improvements.push(`${app}: ${id} fell from ${allowed} to ${counts[id]}`);
        }
    }
    return { regressions, improvements, summary };
}

function option(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv) {
    const root = resolve(option(argv, "--root") ?? REPO_ROOT);
    const baselineArg = option(argv, "--baselines");
    const baselineDir = baselineArg ? resolve(baselineArg) : join(root, BASELINE_DIR);

    if (argv.includes("--list")) {
        const start = argv.indexOf("--list") + 1;
        const named = [];
        for (let i = start; i < argv.length && !argv[i].startsWith("--"); i += 1) named.push(argv[i]);
        const unknown = named.filter((app) => !(app in APPS));
        if (unknown.length) {
            console.error(`Unknown application: ${unknown.join(", ")}. Known: ${Object.keys(APPS).join(", ")}.`);
            return 1;
        }
        for (const app of named.length ? named : Object.keys(APPS)) {
            for (const hit of sweepApp(app, root)) {
                console.log(`${hit.file}:${hit.line}:${hit.column}\t${hit.pattern}\t${hit.text}`);
            }
        }
        return 0;
    }

    if (argv.includes("--write-baselines")) {
        const written = writeBaselines({ root, baselineDir });
        for (const [app, baseline] of Object.entries(written)) {
            console.log(`${app}: ${baseline.total} hits recorded`);
        }
        return 0;
    }

    const { regressions, improvements, summary } = compareWithBaselines({ root, baselineDir });
    for (const [app, { counts, total }] of Object.entries(summary)) {
        const parts = Object.entries(counts).map(([id, n]) => `${id} ${n}`).join(", ");
        console.log(`${app.padEnd(11)} ${String(total).padStart(4)} hits (${parts})`);
    }
    for (const line of improvements) console.log(`lower: ${line}; run --write-baselines to record it`);
    if (regressions.length) {
        console.error(
            "Legacy-brand hits rose above the baseline:\n" +
                regressions.map((line) => `  - ${line}`).join("\n") +
                "\nShow names and addresses through the generated brand module instead " +
                "(packages/brand/README.md); `node scripts/brand-sweep.mjs --list` prints every hit.",
        );
        return 1;
    }
    console.log("No legacy-brand count rose above its baseline.");
    return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    process.exitCode = main(process.argv.slice(2));
}
