#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Validate architecture documents against the committed source tree.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const audit = process.argv.slice(2).includes("--audit");
const validator = fileURLToPath(new URL("../../create-update-architecture-md/scripts/validate-arch.mjs", import.meta.url));

function git(...args) {
  return execFileSync("git", args, { maxBuffer: Infinity });
}
function validateArchitectures(revision) {
  const commit = git("rev-parse", "--verify", `${revision}^{commit}`).toString().trim();
  const entries = git("ls-tree", "-r", "-z", commit).toString().split("\0").filter(Boolean).map((entry) => {
    const tab = entry.indexOf("\t");
    const [mode, type, object] = entry.slice(0, tab).split(" ");
    return { mode, type, object, path: entry.slice(tab + 1) };
  });
  const documents = entries.filter(({ type, path }) => type === "blob" && path.split("/").at(-1) === "ARCHITECTURE.md");
  if (documents.length === 0) return [];

  const gitDir = git("rev-parse", "--absolute-git-dir").toString().trim();
  const snapshot = realpathSync(mkdtempSync(join(tmpdir(), "architecture-validation-")));
  const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: snapshot };
  try {
    for (const entry of entries) {
      const target = join(snapshot, entry.path);
      if (entry.type === "commit") {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const content = git("cat-file", "blob", entry.object);
      if (entry.mode === "120000") symlinkSync(content.toString(), target);
      else writeFileSync(target, content);
    }
    return documents.map(({ path }) => {
      const result = spawnSync(process.execPath, [validator, path, "--repo", snapshot], {
        cwd: snapshot, env, encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n");
      const warnings = output.filter((line) => line.startsWith("WARN: "));
      const errors = result.status === 0 ? [] : [result.error?.message ||
        output.filter((line) => line && !line.startsWith("WARN: ")).join("\n") || "Architecture validator failed"];
      return { path, warnings, errors };
    });
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}
function warning(title, message) {
  const escaped = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::warning title=${title}::${escaped}`);
}
function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}
function main() {
  if (process.argv.length !== (audit ? 3 : 2)) throw new Error("Usage: node check-architecture.mjs [--audit]");
  const revision = audit ? "HEAD" : process.env.HEAD_SHA;
  if (!audit && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision ?? ""))
    throw new Error("HEAD_SHA must be a full commit hash.");
  const documents = validateArchitectures(revision);
  const lines = ["## Architecture audit", "", `Checked **${documents.length}** architecture document(s).`, ""];
  let invalid = false;
  if (documents.length === 0) {
    const message = "No tracked ARCHITECTURE.md documents in the committed tree.";
    if (audit) warning("Architecture missing", message);
    else console.warn(`ARCHITECTURE MISSING: ${message}`);
    lines.push(message, "");
  }
  for (const { path, warnings, errors } of documents) {
    invalid ||= errors.length > 0;
    console.log(`ARCHITECTURE ${errors.length ? "FAILED" : "OK"}: ${path}`);
    lines.push(`### ${path}`, "", errors.length ? "Validation failed." : "Validation passed.", "");
    for (const message of [...errors, ...warnings]) {
      if (audit) warning(errors.includes(message) ? "Architecture invalid" : "Architecture warning", `${path}: ${message}`);
      else console.error(`${path}: ${message}`);
      lines.push("```text", message, "```", "");
    }
  }
  if (audit) {
    lines.push("Warnings keep this GitHub Actions job successful.");
    summary(lines);
  } else process.exitCode = invalid ? 1 : documents.length === 0 ? 2 : 0;
}

try {
  main();
} catch (error) {
  if (audit) {
    warning("Architecture audit error", error.message);
    try {
      summary(["## Architecture audit", "", `Audit error: ${error.message}`]);
    } catch (summaryError) {
      warning("Architecture summary error", summaryError.message);
    }
  } else {
    console.error(`ARCHITECTURE CHECK FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
