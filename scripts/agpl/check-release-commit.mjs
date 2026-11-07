// SPDX-License-Identifier: AGPL-3.0-only
//
// Fail when the commit about to be built is not on the public fork's remote.
//
// AGPL-3.0 section 13 requires network users to be offered the source of the
// exact running version. If a release image were built from a commit that was
// never pushed, the offer would point at source nobody can fetch. This guards
// the release build: the commit must be reachable from a branch on the public
// remote (origin by default).

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Whether `commit` is reachable from a branch on `remote`. Relies on the
 * remote-tracking refs, so CI must fetch the remote (not a shallow checkout
 * that drops them) before calling.
 */
export function isCommitOnRemote({ repoDir, commit = "HEAD", remote = "origin" }) {
  const sha = git(repoDir, ["rev-parse", commit]).trim();
  const contains = git(repoDir, ["branch", "-r", "--contains", sha])
    .split("\n")
    .map((line) => line.replace(/^[*+]?\s*/, "").trim())
    .filter(Boolean);
  const prefix = `${remote}/`;
  return contains.some(
    (ref) => ref === remote || ref.startsWith(prefix),
  );
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function main(argv) {
  const repoDir = argValue(argv, "--repo") ?? process.cwd();
  const commit = argValue(argv, "--commit") ?? "HEAD";
  const remote = argValue(argv, "--remote") ?? "origin";
  let onRemote = false;
  try {
    onRemote = isCommitOnRemote({ repoDir, commit, remote });
  } catch (error) {
    console.error(`check-release-commit: ${error.message}`);
    process.exit(1);
  }
  if (!onRemote) {
    const sha = git(repoDir, ["rev-parse", commit]).trim();
    console.error(
      `Refusing to build ${sha}: it is not on the public remote "${remote}".\n` +
        "Push the commit to the public fork before building a release image,\n" +
        "so the AGPL source offer points at source that can be fetched.",
    );
    process.exit(1);
  }
  console.log(`check-release-commit: ${commit} is on "${remote}".`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
