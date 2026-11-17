#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Informational ADR audit. Requires a full Git checkout (fetch-depth: 0).

import { appendFileSync } from "node:fs";
import {
  CODE_PATHS,
  git,
  gitList,
  isAncestor,
  validateAdrs,
} from "./adr-validation.mjs";

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
      "--no-commit-id",
      "-r",
      "--name-only",
      "-z",
      sha,
      "--",
      ...CODE_PATHS,
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
  const referenced = new Set();
  const invalid = [];

  for (const { path, links, errors } of validateAdrs("HEAD")) {
    if (errors.length === 0) {
      const changedAt = git(
        "log",
        "--no-renames",
        "--format=%H",
        "-n",
        "1",
        "HEAD",
        "--",
        path,
      );
      for (const linked of links) {
        if (
          !changedAt ||
          linked === changedAt ||
          !isAncestor(linked, changedAt)
        ) {
          errors.push(
            `${linked} must be an earlier commit in the history of the last ADR change.`,
          );
        }
      }
    }
    if (errors.length > 0) {
      invalid.push({ path, errors });
      warning("Invalid ADR", `${path}\n${errors.join("\n")}`);
      continue;
    }
    const addedAt = git(
      "log",
      "--no-renames",
      "--diff-filter=A",
      "--format=%H",
      "-n",
      "1",
      "HEAD",
      "--",
      path,
    );
    for (const linked of links) {
      if (addedAt && linked !== addedAt && isAncestor(linked, addedAt))
        referenced.add(linked);
    }
  }

  const commits = git("rev-list", "--no-merges", `--max-count=${limit}`, "HEAD")
    .split("\n")
    .filter(Boolean);
  const impl = commits.filter(changedCode);
  const missing = impl.filter((sha) => !referenced.has(sha));
  for (const sha of missing) {
    warning(
      "ADR missing",
      `Commit ${sha.slice(0, 12)} has no valid ADR reference (${commitPrefix}${sha})`,
    );
  }

  const lines = [
    "## ADR audit",
    "",
    `Scanned **${commits.length}** recent non-merge commits. Implementation commits **${impl.length}**. ` +
      `Missing ADR **${missing.length}**. Invalid ADR **${invalid.length}**.`,
    "",
  ];
  if (missing.length > 0) {
    lines.push("| Implementation commit | ADR |", "| --- | --- |");
    for (const sha of missing) {
      lines.push(
        `| [\`${sha.slice(0, 12)}\`](${commitPrefix}${sha}) | Missing |`,
      );
    }
    lines.push("");
  } else {
    lines.push(
      "All inspected implementation commits have valid ADR references.",
      "",
    );
  }
  if (invalid.length > 0) {
    lines.push("### Invalid ADRs", "", "| File | Errors |", "| --- | --- |");
    for (const { path, errors } of invalid) {
      const file = path.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
      const message = errors
        .join(" ")
        .replace(/[\r\n]/g, " ")
        .replace(/\|/g, "\\|");
      lines.push(`| ${file} | ${message} |`);
    }
    lines.push("");
  }
  lines.push(
    "Each ADR uses the create-adr-md template with URL bullets under `## Implementation Commit`.",
    "Warnings keep this GitHub Actions job successful.",
  );
  summary(lines);
  console.log(
    `ADR audit: ${impl.length} implementation commit(s), ${missing.length} without ADR, ${invalid.length} invalid ADR(s).`,
  );
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
