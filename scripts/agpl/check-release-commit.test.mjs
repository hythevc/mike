// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isCommitOnRemote } from "./check-release-commit.mjs";

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

function commit(dir, message) {
  writeFileSync(path.join(dir, message.replace(/\W+/g, "_") + ".txt"), message);
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

test("passes for a commit on the remote and fails for a local-only commit", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agpl-release-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  try {
    mkdirSync(remote, { recursive: true });
    run(remote, ["init", "-q", "--bare", "-b", "main"]);
    mkdirSync(work, { recursive: true });
    run(work, ["init", "-q", "-b", "main"]);
    run(work, ["remote", "add", "origin", remote]);

    const published = commit(work, "published commit");
    run(work, ["push", "-q", "origin", "main"]);
    run(work, ["fetch", "-q", "origin"]);

    // The pushed commit is reachable from origin/main.
    assert.equal(
      isCommitOnRemote({ repoDir: work, commit: published, remote: "origin" }),
      true,
    );

    // A later local commit that was never pushed is not on the remote.
    const local = commit(work, "unpushed commit");
    assert.equal(
      isCommitOnRemote({ repoDir: work, commit: local, remote: "origin" }),
      false,
    );
    // A different remote name is likewise not satisfied.
    assert.equal(
      isCommitOnRemote({ repoDir: work, commit: published, remote: "upstream" }),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
