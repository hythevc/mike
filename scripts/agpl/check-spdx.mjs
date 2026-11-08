// SPDX-License-Identifier: AGPL-3.0-only
//
// Fail when a fork-authored source file added since the fork base lacks the
// SPDX licence line. Every new source file in the fork must start with
// `SPDX-License-Identifier: AGPL-3.0-only` in its own comment syntax; this is
// the executable half of that rule.
//
// It covers only fork code — backend/src, frontend/src, word-addin/src,
// scripts, packages and backend/migrations — and only the source extensions
// that carry a comment. Markdown, JSON, images, generated, vendored and
// third-party files are never flagged (JSON has no comments, and the fork's
// JSON convention uses a "$comment" key instead).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const COMMIT = /\b[0-9a-f]{40}\b/;
const SPDX_LINE = "SPDX-License-Identifier: AGPL-3.0-only";

/** Roots whose added source files must carry the SPDX line. */
export const COVERED_ROOTS = [
  "backend/src/",
  "frontend/src/",
  "word-addin/src/",
  "scripts/",
  "packages/",
  "backend/migrations/",
];

/** Extensions that carry a comment and so must carry the SPDX line. */
export const COVERED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".sql",
];

/** Paths that are generated, vendored or third-party and never flagged. */
const EXCLUDED = [
  /(^|\/)node_modules\//,
  /\.d\.ts$/,
  /\.generated\./,
  /(^|\/)(vendor|vendored|third[-_]party|__generated__|generated)\//,
];

/** Whether an added file under a covered root must carry the SPDX line. */
export function isCovered(file) {
  if (!COVERED_ROOTS.some((root) => file.startsWith(root))) return false;
  if (!COVERED_EXTENSIONS.some((ext) => file.endsWith(ext))) return false;
  return !EXCLUDED.some((pattern) => pattern.test(file));
}

export function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The fork base commit recorded in UPSTREAM.md ("Fork base commit:" line). */
export function forkBaseCommit(upstreamMarkdown) {
  for (const line of upstreamMarkdown.split("\n")) {
    if (/fork base commit/i.test(line)) {
      const match = line.match(COMMIT);
      if (match) return match[0];
    }
  }
  throw new Error(
    "UPSTREAM.md has no 'Fork base commit: <40-char sha>' line",
  );
}

/** Whether a file's current content carries the SPDX line. */
export function hasSpdx(contents) {
  return contents.includes(SPDX_LINE);
}

/**
 * Covered source files added since `base` that lack the SPDX line, sorted.
 * Deleted files are skipped (A filter), and a file removed after being added
 * is ignored because it no longer exists.
 */
export function findMissingSpdx({ repoDir, base, until = "HEAD" }) {
  const added = git(repoDir, [
    "diff",
    "--name-only",
    "--diff-filter=A",
    base,
    until,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isCovered);
  const missing = [];
  for (const file of added) {
    const full = path.join(repoDir, file);
    if (!existsSync(full)) continue;
    if (!hasSpdx(readFileSync(full, "utf8"))) missing.push(file);
  }
  return missing.sort();
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function main(argv) {
  const repoDir = argValue(argv, "--repo") ?? process.cwd();
  const base =
    argValue(argv, "--base") ??
    forkBaseCommit(readFileSync(path.join(repoDir, "UPSTREAM.md"), "utf8"));
  const missing = findMissingSpdx({ repoDir, base });
  if (missing.length > 0) {
    console.error(
      `Missing "${SPDX_LINE}" in ${missing.length} fork-authored file(s):`,
    );
    for (const file of missing) console.error(`  ${file}`);
    console.error(
      "\nAdd the SPDX line at the top of each file, in its comment syntax.",
    );
    process.exit(1);
  }
  console.log(`check-spdx: all covered files added since ${base} carry the SPDX line.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
