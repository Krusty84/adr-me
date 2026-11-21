#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Validate changed ADRs and check new code commits in the tree pushed to main.

import { execFileSync, spawnSync } from "node:child_process";
import { codePathspecs, missingAdrCommits } from "./adr-policy.mjs";
import {
  gitList,
  isAncestor,
  validateAdrs,
} from "../../create-adr-md/scripts/validate-adr.mjs";

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

  const changed = before === zero ? undefined : gitList(
    "diff",
    "--no-renames",
    "--name-only",
    "--diff-filter=AMT",
    "-z",
    before,
    after,
    "--",
    ADR_PATH,
  ).filter((path) => path.endsWith(".md"));
  const range = before === zero ? after : `${before}..${after}`;
  const commits = codePathspecs?.length
    ? execFileSync(
      "git",
      ["rev-list", "--no-merges", "--full-history", range, "--", ...codePathspecs],
      { encoding: "utf8", maxBuffer: Infinity },
    ).trim().split("\n").filter(Boolean)
    : [];
  const adrs = validateAdrs(after, commits.length > 0 ? undefined : changed);
  const changedPaths = new Set(changed);
  const checked = changed ? adrs.filter(({ path }) => changedPaths.has(path)) : adrs;
  for (const { path, links, errors } of checked) {
    if (errors.length > 0) fail(`${path} at ${after}:\n${errors.join("\n")}`);
    for (const linked of links) console.log(`ADR link OK: ${path} -> ${linked}`);
  }
  console.log(`ADR OK: ${checked.length} ADR(s) checked.`);

  const missing = missingAdrCommits(commits, adrs);
  for (const sha of missing) console.warn(`WARNING: No valid ADR links to code commit ${sha}`);
  if (missing.length > 0) process.exitCode = 2; // The hook asks for confirmation.
}

try {
  main();
} catch (error) {
  console.error(`ADR CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
}
