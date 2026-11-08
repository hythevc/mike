// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  lastSyncedCommit,
  listModifications,
  renderModifications,
} from "./modifications.mjs";

// A git fixture isolated from any global/system config, with deterministic
// dates, so these tests never read or write the real git configuration.
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "agpl-mods-"));
  run(dir, ["init", "-q", "-b", "main"]);
  return dir;
}

function run(dir, args, date) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  if (date) {
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  return execFileSync("git", ["-C", dir, ...args], { env, encoding: "utf8" });
}

function commit(dir, { message, date, write = {} }) {
  for (const [file, contents] of Object.entries(write)) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  run(dir, ["add", "-A"]);
  run(
    dir,
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "-q",
      "-m",
      message,
    ],
    date,
  );
  return run(dir, ["rev-parse", "HEAD"]).trim();
}

test("lastSyncedCommit reads the sha from the UPSTREAM.md marker", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const md = [
    "# Upstream",
    "- Fork base commit: " + "f".repeat(40),
    `- Last synced upstream commit: ${sha} (v2.1.0)`,
  ].join("\n");
  assert.equal(lastSyncedCommit(md), sha);
  assert.throws(() => lastSyncedCommit("# nothing here"));
});

test("lists a modified fork file with its date and omits upstream's later changes", () => {
  const dir = makeRepo();
  try {
    const since = commit(dir, {
      message: "upstream baseline",
      date: "2026-10-01T10:00:00",
      write: {
        "backend/src/shared.ts": "// SPDX\nexport const a = 1;\n",
        "backend/src/upstreamOnly.ts": "// SPDX\nexport const u = 1;\n",
      },
    });

    // Our own change on the mainline.
    commit(dir, {
      message: "fork: add a feature",
      date: "2026-11-02T10:00:00",
      write: {
        "backend/src/forked.ts": "// SPDX\nexport const x = 2;\n",
        "backend/src/shared.ts": "// SPDX\nexport const a = 2;\n",
      },
    });

    // Upstream keeps developing after the sync, on a branch we have NOT
    // merged; its change to upstreamOnly.ts must not appear in our ledger.
    run(dir, ["branch", "upstream-later", since]);
    run(dir, ["checkout", "-q", "upstream-later"]);
    commit(dir, {
      message: "upstream: change after our sync",
      date: "2026-11-05T10:00:00",
      write: { "backend/src/upstreamOnly.ts": "// SPDX\nexport const u = 9;\n" },
    });
    run(dir, ["checkout", "-q", "main"]);

    const entries = listModifications({ repoDir: dir, since });
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));

    assert.deepEqual(byPath["backend/src/forked.ts"], {
      path: "backend/src/forked.ts",
      status: "added",
      date: "2026-11-02",
    });
    assert.equal(byPath["backend/src/shared.ts"].status, "modified");
    assert.equal(byPath["backend/src/shared.ts"].date, "2026-11-02");
    // Upstream's own post-sync change is omitted.
    assert.equal(byPath["backend/src/upstreamOnly.ts"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderModifications produces a dated Markdown ledger", () => {
  const markdown = renderModifications(
    [
      { path: "backend/src/forked.ts", status: "added", date: "2026-11-02" },
      { path: "frontend/src/app/x.tsx", status: "modified", date: "2026-11-03" },
    ],
    { project: "Mike", since: "a".repeat(40), generatedAt: "2026-11-07" },
  );
  assert.match(markdown, /# Modifications/);
  assert.match(markdown, /section 5\(a\)/);
  assert.match(markdown, /2 files changed/);
  assert.match(
    markdown,
    /\| `backend\/src\/forked\.ts` \| added \| 2026-11-02 \|/,
  );
});
