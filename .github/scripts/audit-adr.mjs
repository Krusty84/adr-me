#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Informational ADR audit. Requires a full Git checkout (fetch-depth: 0).

import { appendFileSync } from "node:fs";
import { codePathspecs, missingAdrCommits } from "./adr-policy.mjs";
import {
  git,
  gitList,
  validateAdrs,
} from "../../create-adr-md/scripts/validate-adr.mjs";

function warning(title, message) {
  const escaped = message
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.log(`::warning title=${title}::${escaped}`);
}
function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${lines.join("\n")}\n`,
      "utf8",
    );
  }
}
function changedCode(sha) {
  return (
    gitList(
      "diff-tree",
      "--root",
      "--no-renames",
      "--no-commit-id",
      "-r",
      "--name-only",
      "-z",
      sha,
      "--",
      ...codePathspecs,
    ).length > 0
  );
}

function main() {
  const rawLimit = Number.parseInt(process.env.ADR_SCAN_LIMIT ?? "30", 10);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 500
      ? rawLimit
      : 30;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = (
    process.env.GITHUB_SERVER_URL ?? "https://github.com"
  ).replace(/\/$/, "");
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo))
    throw new Error("GITHUB_REPOSITORY must be OWNER/REPO");
  const commitPrefix = `${server}/${repo}/commit/`;
  let missing = 0;

  const lines = ["## ADR audit", ""];
  if (codePathspecs?.length) {
    const commits = git("rev-list", "--no-merges", `--max-count=${limit}`, "HEAD")
      .split("\n")
      .filter(Boolean);
    const review = missingAdrCommits(commits.filter(changedCode), validateAdrs("HEAD"));
    missing = review.length;
    lines.push(
      "### Changes to review",
      "",
      `Missing ADR **${missing}**.`,
      "",
      `Scanned **${commits.length}** recent non-merge commits for changes in CODE_PATHS.`,
      "These commits have no link from a valid ADR. An ADR is optional.",
      "",
    );
    if (review.length > 0) lines.push("| Commit |", "| --- |");
    for (const sha of review) {
      warning("ADR missing", `No ADR links to code commit ${sha}: ${commitPrefix}${sha}`);
      lines.push(
        `| [\`${sha.slice(0, 12)}\`](${commitPrefix}${sha}) |`,
      );
    }
    if (review.length === 0) lines.push("No changes to review in this scan.");
    lines.push("");
  } else {
    const note = codePathspecs
      ? "Review hints skipped: CODE_PATHS is not configured."
      : "Review hints skipped: CODE_PATHS must be a list of relative file or directory paths.";
    lines.push(note, "");
    console.log(note);
  }
  lines.push(
    "Each ADR uses the create-adr-md template with URL bullets under `## Implementation Commit`.",
    "Warnings keep this GitHub Actions job successful.",
  );
  summary(lines);
  console.log(`ADR audit: ${missing} without ADR.`);
}

try {
  main();
} catch (error) {
  warning("ADR audit error", error.message);
  try {
    summary(["## ADR audit", "", `Audit error — ${error.message}`]);
  } catch (summaryError) {
    warning("ADR summary error", summaryError.message);
  }
}
