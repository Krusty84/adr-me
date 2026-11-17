#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Check commits introduced by a push to main. Keep the history linear.
// Each new code commit needs a new ADR in a later commit in the same push.

import { spawnSync } from "node:child_process";
import {
  CODE_PATHS,
  git,
  gitList,
  isAncestor,
  validateAdrs,
} from "./adr-validation.mjs";

const ADR_PATH = "docs/adr/";
const before = process.env.BASE_SHA?.toLowerCase();
const after = process.env.HEAD_SHA?.toLowerCase();
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const fail = (message) => {
  throw new Error(message);
};

function gitExists(sha) {
  return (
    spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" })
      .status === 0
  );
}
function commitFiles(sha, pathspec, filter = null) {
  return gitList(
    "diff-tree",
    "--root",
    "--no-renames",
    "--no-commit-id",
    "-r",
    ...(filter ? [`--diff-filter=${filter}`] : []),
    "--name-only",
    "-z",
    sha,
    "--",
    ...(Array.isArray(pathspec) ? pathspec : [pathspec]),
  );
}

function main() {
  if (
    !before ||
    !after ||
    !SHA_PATTERN.test(before) ||
    !SHA_PATTERN.test(after) ||
    before.length !== after.length
  ) {
    fail(
      "BASE_SHA and HEAD_SHA must be full commit hashes (or all-zero BASE_SHA for a new branch).",
    );
  }
  const zero = "0".repeat(after.length);
  if (after === zero || !gitExists(after))
    fail(`Commit ${after} does not exist locally.`);
  if (before !== zero && !gitExists(before))
    fail(`Base commit ${before} not found. Run: git fetch origin main`);
  if (before !== zero && !isAncestor(before, after))
    fail("Non-fast-forward main update is unsupported.");
  if (before === after) {
    console.log("ADR OK: nothing to push.");
    return;
  }

  const commits = git(
    "rev-list",
    "--reverse",
    before === zero ? after : `${before}..${after}`,
  )
    .split("\n")
    .filter(Boolean);
  const newCodeCommits = new Set();
  const newAdrs = new Map();

  for (const sha of commits) {
    const parents = git("rev-list", "--parents", "-n", "1", sha).split(/\s+/);
    if (parents.length > 2)
      fail(`Merge commit ${sha} is unsupported. Keep main linear.`);
    if (commitFiles(sha, CODE_PATHS).length > 0) newCodeCommits.add(sha);

    const added = new Set(commitFiles(sha, ADR_PATH, "A"));
    const changed = commitFiles(sha, ADR_PATH, "AMT").filter((path) =>
      path.endsWith(".md"),
    );
    for (const path of commitFiles(sha, ADR_PATH, "D")) newAdrs.delete(path);

    for (const { path, links, errors } of validateAdrs(sha, changed)) {
      if (errors.length > 0) fail(`${path} at ${sha}:\n${errors.join("\n")}`);
      for (const linked of links) {
        if (linked === sha || !isAncestor(linked, sha)) {
          fail(
            `${path}: ${linked} must be an earlier commit in the history of ${sha}.`,
          );
        }
        console.log(`ADR link OK: ${path} -> ${linked}`);
      }
      if (added.has(path)) newAdrs.set(path, { addedAt: sha, links });
      else if (newAdrs.has(path)) newAdrs.get(path).links = links;
    }
  }

  const covered = new Set();
  for (const { addedAt, links } of newAdrs.values()) {
    for (const linked of links) {
      if (
        newCodeCommits.has(linked) &&
        linked !== addedAt &&
        isAncestor(linked, addedAt)
      ) {
        covered.add(linked);
      }
    }
  }
  const uncovered = [...newCodeCommits].filter((sha) => !covered.has(sha));
  if (uncovered.length > 0) {
    fail(
      `${uncovered.length} code commit(s) lack a later ADR in this push:\n  ${uncovered.join("\n  ")}\n` +
        "Create docs/adr/NNNN-title.md with commit URL bullets under ## Implementation Commit, " +
        "then commit the ADR separately and push both commits together.",
    );
  }
  console.log(
    `ADR OK: ${newCodeCommits.size} code commit(s), ${newAdrs.size} new ADR(s).`,
  );
}

try {
  main();
} catch (error) {
  console.error(`ADR CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
}
