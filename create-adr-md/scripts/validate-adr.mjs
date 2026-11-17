#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Strict, offline ADR schema and local Git verification. Node.js 18+; no dependencies.

import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const SECTIONS = [
  "Context",
  "Decision",
  "Rationale",
  "Alternatives",
  "Consequences",
  "Implementation",
  "Implementation Commit",
];
const ATTRIBUTES = ["Status", "Date", "Record Type", "Evidence"];
const VALUES = {
  Status: ["Accepted"],
  "Record Type": ["Agent-Session", "Retrospective"],
  Evidence: ["Agent Session", "Git History", "Manual", "Mixed"],
};
const MAX_TITLE_CHARACTERS = 120;
const MAX_PROSE_WORDS = 350;
const SHA_PATTERN = "(?:[0-9a-f]{40}|[0-9a-f]{64})";
const errors = [];

function fail(message) {
  errors.push(message);
}
function usage() {
  console.log(
    "Usage: node validate-adr.mjs <docs/adr/NNNN-slug.md> [--repo <path>] [--remote <name>]",
  );
  console.log(
    "Requires a local Git repository and a configured web-accessible Git remote (default: origin).",
  );
}
function git(repo, ...args) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}
function parseArguments(args) {
  let file = null;
  let repo = null;
  let remote = "origin";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--repo" || arg === "--remote") {
      if (i + 1 >= args.length) throw Error(`Missing value for ${arg}`);
      const value = args[++i];
      if (arg === "--repo") repo = value;
      else remote = value;
    } else if (arg.startsWith("-")) throw Error(`Unknown option: ${arg}`);
    else if (file !== null) throw Error("Provide exactly one ADR file");
    else file = arg;
  }
  if (!file) throw Error("Missing ADR filename");
  if (!/^[\w.-]+$/.test(remote)) throw Error("Invalid remote name");
  return { file, repo, remote };
}
function normalizeProjectPath(p) {
  return decodeURIComponent(p)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
}
function parseRemote(remoteUrl) {
  let url;
  try {
    if (/^[^/@:\s]+@[^/:\s]+:.+$/.test(remoteUrl)) {
      const match = remoteUrl.match(/^[^/@:\s]+@([^/:\s]+):(.+)$/);
      return {
        host: match[1].toLowerCase(),
        project: normalizeProjectPath(match[2]),
      };
    }
    url = new URL(remoteUrl);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
      return null;
    return {
      host: url.hostname.toLowerCase(),
      project: normalizeProjectPath(url.pathname),
    };
  } catch {
    return null;
  }
}
function parseCommitURL(raw) {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const match = url.pathname.match(
      new RegExp(`^(.*?)(?:/-)?/commits?/(${SHA_PATTERN})/?$`, "i"),
    );
    if (!match || !match[1]) return null;
    return {
      host: url.hostname.toLowerCase(),
      project: normalizeProjectPath(match[1]),
      sha: match[2].toLowerCase(),
    };
  } catch {
    return null;
  }
}
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}
function isPlaceholder(s) {
  return /<[^<>\n]+>|\b(?:TODO|TBD|FIXME)\b|\{\{.+?\}\}/i.test(s);
}

function main() {
  let opts;
  try {
    opts = parseArguments(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    usage();
    process.exitCode = 2;
    return;
  }

  const cwd = opts.repo ? resolve(opts.repo) : process.cwd();
  const repo = git(cwd, "rev-parse", "--show-toplevel");
  if (!repo) {
    console.error(
      "Error: --repo or current directory is not inside a Git worktree",
    );
    process.exitCode = 2;
    return;
  }
  const root = realpathSync(repo);
  const source = isAbsolute(opts.file) ? opts.file : resolve(cwd, opts.file);
  const sourceStat = lstatSync(source, { throwIfNoEntry: false });
  if (sourceStat?.isSymbolicLink()) {
    fail(`ADR file is a symbolic link: ${source}`);
    finish();
    return;
  }
  if (!sourceStat?.isFile()) {
    fail(`ADR file does not exist: ${source}`);
    finish();
    return;
  }
  const file = realpathSync(source);
  const rel = relative(root, file).split(sep).join("/");
  const filename = basename(file);
  const nameMatch = filename.match(/^(\d{4,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
  if (
    !rel.startsWith("docs/adr/") ||
    rel.split("/").length !== 3 ||
    !nameMatch
  ) {
    fail(
      "ADR path must be docs/adr/NNNN-lowercase-slug.md inside the Git repository",
    );
  }

  const text = readFileSync(file, "utf8");
  if (text.includes("\r")) fail("Use LF line endings");
  const lines = text.replace(/\n$/, "").split("\n");
  const title = lines[0]?.match(/^# ADR-(\d{4,}): (\S.*)$/);
  if (!title) fail("First line must be # ADR-NNNN: Short decision title");
  if (title && nameMatch && title[1] !== nameMatch[1])
    fail("ADR ID in the title does not match the filename");
  if (title && isPlaceholder(title[2])) fail("Title contains a placeholder");
  if (title && title[2].length > MAX_TITLE_CHARACTERS)
    fail(`ADR title must be at most ${MAX_TITLE_CHARACTERS} characters`);
  if (nameMatch) {
    const collisions = readdirSync(join(root, "docs", "adr")).filter(
      (name) =>
        name !== filename &&
        name.startsWith(`${nameMatch[1]}-`) &&
        name.endsWith(".md"),
    );
    if (collisions.length)
      fail(`ADR ID ${nameMatch[1]} is also used by: ${collisions.join(", ")}`);
  }

  const headers = [];
  lines.forEach((line, index) => {
    if (index > 0 && /^#{1,6} /.test(line) && !/^## /.test(line)) {
      fail(
        `Unexpected Markdown heading on line ${index + 1}; only the fixed section headings are allowed`,
      );
    }
    if (/^## /.test(line))
      headers.push({ title: line.slice(3).trim(), line: index });
  });
  if (
    headers.length !== SECTIONS.length ||
    headers.some((h, i) => h.title !== SECTIONS[i])
  ) {
    fail(
      `Sections must appear exactly once in this order: ${SECTIONS.join(" -> ")}`,
    );
  }
  const firstSectionLine = headers.length ? headers[0].line : lines.length;
  const metadata = lines
    .slice(1, firstSectionLine)
    .filter((line) => line.trim().length > 0);
  if (metadata.length !== ATTRIBUTES.length) {
    fail(`Exactly ${ATTRIBUTES.length} metadata attributes are required`);
  }
  const attrs = {};
  for (let i = 0; i < metadata.length; i++) {
    const match = metadata[i].match(/^\*\*([^*]+):\*\* (.*)$/);
    if (!match || match[1] !== ATTRIBUTES[i]) {
      fail(
        `Metadata attribute #${i + 1} must be **${ATTRIBUTES[i] ?? "(none)"}:** <value>`,
      );
      continue;
    }
    const value = match[2].trim();
    if (!value) fail(`${match[1]} must have a non-empty value`);
    attrs[match[1]] = value;
  }
  for (const [key, allowed] of Object.entries(VALUES)) {
    if (attrs[key] && !allowed.includes(attrs[key]))
      fail(`Invalid ${key}: ${attrs[key]}. Allowed: ${allowed.join(", ")}`);
  }
  if (attrs.Date && !isValidDate(attrs.Date))
    fail("Date must be a valid ISO calendar date (YYYY-MM-DD)");
  if (metadata.some((line) => isPlaceholder(line)))
    fail("Metadata contains a placeholder");

  const bodies = new Map();
  for (let i = 0; i < headers.length; i++) {
    const nextLine =
      i + 1 < headers.length ? headers[i + 1].line : lines.length;
    bodies.set(
      headers[i].title,
      lines
        .slice(headers[i].line + 1, nextLine)
        .join("\n")
        .trim(),
    );
  }
  for (const section of SECTIONS) {
    const body = bodies.get(section);
    if (!body) {
      fail(`${section} section is missing or empty`);
      continue;
    }
    if (isPlaceholder(body)) fail(`${section} contains a placeholder`);
    if (
      section !== "Implementation Commit" &&
      /^not recorded\.?$/i.test(body) &&
      ["Decision", "Implementation"].includes(section)
    ) {
      fail(`${section} must contain verified facts, not "Not recorded."`);
    }
  }

  const prose = [
    title?.[2] ?? "",
    ...SECTIONS.slice(0, -1).map((s) => bodies.get(s) ?? ""),
  ].join(" ");
  const words = prose.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length > MAX_PROSE_WORDS)
    fail(
      `ADR exceeds the ${MAX_PROSE_WORDS}-word prose budget (${words.length} words)`,
    );
  if (
    /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Hangul}]/u.test(
      prose,
    )
  ) {
    fail("ADR prose appears to contain non-English script");
  }

  const remoteUrl = git(root, "remote", "get-url", opts.remote);
  if (!remoteUrl) fail(`Git remote ${opts.remote} does not exist`);
  const remote = remoteUrl ? parseRemote(remoteUrl) : null;
  if (remoteUrl && !remote)
    fail(`Cannot parse Git remote ${opts.remote} as a hosted repository URL`);

  const impl = bodies.get("Implementation Commit") ?? "";
  const implLines = impl
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!implLines.length)
    fail("Implementation Commit requires at least one URL");
  const seen = new Set();
  for (const line of implLines) {
    if (!line.startsWith("- https://")) {
      fail(
        "Each Implementation Commit entry must be a bullet: - https://host/repo/commit/<full-SHA>",
      );
      continue;
    }
    const raw = line.slice(2).trim();
    const parsed = parseCommitURL(raw);
    if (!parsed) {
      fail(`Invalid commit URL: ${raw}`);
      continue;
    }
    if (seen.has(parsed.sha))
      fail(`Duplicate implementation SHA: ${parsed.sha}`);
    seen.add(parsed.sha);
    if (
      remote &&
      (parsed.host !== remote.host || parsed.project !== remote.project)
    ) {
      fail(`Commit URL does not match Git remote ${opts.remote}: ${raw}`);
    }
    if (git(root, "cat-file", "-t", parsed.sha) !== "commit") {
      fail(`Implementation commit is not present locally: ${parsed.sha}`);
    }
  }

  finish(file);
}
function finish(file) {
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`FAIL: ${errors.length} ADR validation error(s)`);
    process.exitCode = 1;
  } else {
    console.log(
      `PASS: ADR structure, local commits, and remote URL format: ${file}`,
    );
    console.log(
      "NOTE: Human review is still required for facts, ASD-STE100, and remote URL reachability.",
    );
  }
}
main();
