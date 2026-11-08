// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  forkBaseCommit,
  isCovered,
  findMissingSpdx,
} from "./check-spdx.mjs";

const SPDX = "// SPDX-License-Identifier: AGPL-3.0-only\n";

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "agpl-spdx-"));
  run(dir, ["init", "-q", "-b", "main"]);
  return dir;
}

function run(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
    encoding: "utf8",
  });
}

function commit(dir, message, write = {}) {
  for (const [file, contents] of Object.entries(write)) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  run(dir, ["add", "-A"]);
  run(dir, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  return run(dir, ["rev-parse", "HEAD"]).trim();
}

test("forkBaseCommit reads the sha from the UPSTREAM.md marker", () => {
  const sha = "a".repeat(40);
  assert.equal(forkBaseCommit(`- Fork base commit: ${sha} (v2.1.0)`), sha);
  assert.throws(() => forkBaseCommit("no marker here"));
});

test("isCovered selects fork source and ignores docs, data, images and vendored paths", () => {
  assert.equal(isCovered("backend/src/modules/x/y.ts"), true);
  assert.equal(isCovered("frontend/src/app/page.tsx"), true);
  assert.equal(isCovered("backend/migrations/20261107_50_x.sql"), true);
  assert.equal(isCovered("scripts/agpl/x.mjs"), true);
  // Not a source extension, or not a covered root.
  assert.equal(isCovered("README.md"), false);
  assert.equal(isCovered("packages/brand/brand.json"), false);
  assert.equal(isCovered("frontend/src/app/icon.svg"), false);
  assert.equal(isCovered("docs/x.ts"), false);
  // Generated and vendored paths are excluded.
  assert.equal(isCovered("backend/src/lib/brand.generated.ts"), false);
  assert.equal(isCovered("frontend/src/vendor/thing.ts"), false);
  assert.equal(isCovered("backend/src/types/x.d.ts"), false);
});

test("fails on a new .ts without the SPDX line, passes with it, ignores non-source", () => {
  const dir = makeRepo();
  try {
    const base = commit(dir, "baseline", {
      "backend/src/base.ts": SPDX + "export const b = 1;\n",
    });

    commit(dir, "fork changes", {
      // Added source file WITHOUT the SPDX line — must be flagged.
      "backend/src/missing.ts": "export const m = 1;\n",
      // Added source file WITH the SPDX line — must pass.
      "frontend/src/app/ok.tsx": SPDX + "export const Ok = () => null;\n",
      // Non-source and vendored additions — must be ignored.
      "docs/new-guide.md": "# No SPDX in Markdown\n",
      "packages/brand/data.json": '{"x":1}\n',
      "frontend/src/vendor/lib.ts": "export const v = 1;\n",
    });

    const missing = findMissingSpdx({ repoDir: dir, base });
    assert.deepEqual(missing, ["backend/src/missing.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("passes when every added source file carries the SPDX line", () => {
  const dir = makeRepo();
  try {
    const base = commit(dir, "baseline", {
      "backend/src/base.ts": SPDX + "export const b = 1;\n",
    });
    commit(dir, "fork changes", {
      "backend/src/added.ts": SPDX + "export const a = 1;\n",
      "backend/migrations/20261107_50_x.sql":
        "-- SPDX-License-Identifier: AGPL-3.0-only\nselect 1;\n",
    });
    assert.deepEqual(findMissingSpdx({ repoDir: dir, base }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
