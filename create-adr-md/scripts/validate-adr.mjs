#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Strict, offline ADR schema and local Git verification. Node.js 18+; no dependencies.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SECTIONS = [
  "Context",
  "Decision",
  "Rationale",
  "Alternatives",
  "Consequences",
  "Implementation",
  "Implementation Commit",
];
const RELATED_SYMBOLS = "Related Symbols";
const TYPE_CATALOG_SECTIONS = [
  "TypeScript and JavaScript",
  "C and C++",
  "Swift",
  "Python",
  "Rust",
  "Go",
];
const ATTRIBUTES = ["Status", "Date", "Record Type", "Evidence"];
const VALUES = {
  Status: ["Accepted"],
  "Record Type": ["Agent-Session", "Retrospective"],
  Evidence: ["Agent Session", "Git History", "Manual", "Mixed"],
};
const TEMPLATE_PLACEHOLDERS = readFileSync(
  new URL("../templates/adr.md", import.meta.url),
  "utf8",
).match(/<[^<>\n]+>/g) ?? [];
const SHA_PATTERN = "(?:[0-9a-f]{40}|[0-9a-f]{64})";
const errors = [];

function fail(message) {
  errors.push(message);
}
function usage() {
  console.log(
    "Usage: node validate-adr.mjs <docs/adr/NNNN-slug.md> [--repo <path>] [--remote <name>] [--source-revision <full-SHA>]",
  );
  console.log(
    "Requires a local Git repository and a configured web-accessible Git remote (default: origin).",
  );
}
function gitInRepo(repo, ...args) {
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
  let sourceRevision = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (["--repo", "--remote", "--source-revision"].includes(arg)) {
      if (i + 1 >= args.length) throw Error(`Missing value for ${arg}`);
      const value = args[++i];
      if (arg === "--repo") repo = value;
      else if (arg === "--remote") remote = value;
      else sourceRevision = value;
    } else if (arg.startsWith("-")) throw Error(`Unknown option: ${arg}`);
    else if (file !== null) throw Error("Provide exactly one ADR file");
    else file = arg;
  }
  if (!file) throw Error("Missing ADR filename");
  if (!/^[\w.-]+$/.test(remote)) throw Error("Invalid remote name");
  if (sourceRevision !== null && !new RegExp(`^${SHA_PATTERN}$`, "i").test(sourceRevision))
    throw Error("--source-revision requires a full commit SHA");
  return { file, repo, remote, sourceRevision };
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
  return TEMPLATE_PLACEHOLDERS.some((placeholder) => s.includes(placeholder));
}

function outsideFences(lines) {
  let fence = null;
  return lines.map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker && marker[1][0] === fence[0] &&
        marker[1].length >= fence.length && !marker[2].trim()
      ) fence = null;
      return "";
    }
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = marker[1];
      return "";
    }
    return line;
  });
}
function readSections(lines) {
  const visible = outsideFences(lines);
  const headers = [];
  visible.forEach((line, index) => {
    if (/^## /.test(line))
      headers.push({ title: line.slice(3).trim(), line: index });
  });
  const bodies = new Map(headers.map((header, index) => [
    header.title,
    lines.slice(header.line + 1, headers[index + 1]?.line ?? lines.length)
      .join("\n").trim(),
  ]));
  return { visible, headers, bodies };
}
function parseTableRow(line) {
  const value = line.trim();
  if (!value.startsWith("|") || !value.endsWith("|")) return null;
  const cells = [];
  let cell = "";
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] === "\\" && value[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (value[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += value[i];
  }
  cells.push(cell.trim());
  return cells;
}
function isTableSeparator(cells, count) {
  return cells?.length === count &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
function loadSymbolTypes() {
  const catalog = fileURLToPath(
    new URL("../references/types.md", import.meta.url),
  );
  if (!existsSync(catalog))
    throw Error("references/types.md does not exist");
  const text = readFileSync(catalog, "utf8");
  if (text.includes("\r"))
    throw Error("references/types.md must use LF line endings");
  const lines = text.replace(/\n$/, "").split("\n");
  const { headers, bodies } = readSections(lines);
  const sectionTitles = new Set();
  for (const { title } of headers) {
    if (sectionTitles.has(title))
      throw Error(`references/types.md repeats section: ${title}`);
    sectionTitles.add(title);
  }
  for (const title of TYPE_CATALOG_SECTIONS) {
    if (headers.filter((header) => header.title === title).length !== 1)
      throw Error(`references/types.md requires one ${title} section`);
  }
  const types = new Set();
  for (const { title } of headers) {
    const table = (bodies.get(title) ?? "").split("\n")
      .filter((line) => line.trim());
    const heading = parseTableRow(table[0] ?? "");
    if (heading?.length !== 2 || heading[0] !== "Type" || heading[1] !== "Use for")
      throw Error(`${title} must start with the table header: | Type | Use for |`);
    if (!isTableSeparator(parseTableRow(table[1] ?? ""), 2))
      throw Error(`${title} requires a two-column Markdown table separator`);
    if (table.length < 3)
      throw Error(`${title} requires at least one symbol type`);
    const sectionTypes = new Set();
    for (const line of table.slice(2)) {
      const row = parseTableRow(line);
      const match = row?.[0]?.match(/^`([a-z]+(?:-[a-z]+)*)`$/);
      if (row?.length !== 2 || !match || !row[1])
        throw Error(`${title} has an invalid type row: ${line.trim()}`);
      if (sectionTypes.has(match[1]))
        throw Error(`${title} repeats symbol type: ${match[1]}`);
      sectionTypes.add(match[1]);
      types.add(match[1]);
    }
  }
  return types;
}
function sourceFileExists(root, path, revision) {
  if (revision) {
    const entries = gitInRepo(root, "--literal-pathspecs", "ls-tree", "-z", revision, "--", path);
    return (entries ?? "").split("\0").some((entry) => {
      const tab = entry.indexOf("\t");
      return /^100(?:644|755) blob /.test(entry) && entry.slice(tab + 1) === path;
    });
  }
  let target = root;
  for (const part of path.split("/")) {
    if (
      !lstatSync(target, { throwIfNoEntry: false })?.isDirectory() ||
      !readdirSync(target).includes(part)
    ) return false;
    target = join(target, part);
  }
  return lstatSync(target, { throwIfNoEntry: false })?.isFile() ?? false;
}
function validateRelatedSymbols(body, root, revision, allowedTypes) {
  if (isPlaceholder(body ?? "")) {
    fail("Related Symbols contains a placeholder");
    return;
  }
  const lines = outsideFences((body ?? "").split("\n"))
    .filter((line) => line.trim());
  if (lines.length === 0) return;
  const heading = parseTableRow(lines[0]);
  if (
    heading?.length !== 3 ||
    heading[0] !== "Symbol" || heading[1] !== "File" || heading[2] !== "Type"
  ) {
    fail("Related Symbols must start with the table header: | Symbol | File | Type |");
    return;
  }
  if (!isTableSeparator(parseTableRow(lines[1] ?? ""), 3)) {
    fail("Related Symbols requires a three-column Markdown table separator");
    return;
  }
  const seen = new Set();
  for (const line of lines.slice(2)) {
    const row = parseTableRow(line);
    if (row?.length !== 3) {
      fail(`Each Related Symbols row must have three columns: ${line.trim()}`);
      continue;
    }
    const symbolMatch = row[0].match(/^`([^`]+)`$/);
    const pathMatch = row[1].match(/^`([^`]+)`$/);
    const symbol = symbolMatch?.[1];
    const path = pathMatch?.[1];
    const invalidParentheses = /[()]/.test(symbol ?? "") &&
      !/(?:^|[.:])operator\(\)$/.test(symbol ?? "");
    if (
      !symbolMatch || /[\s`\\]/u.test(symbol) || invalidParentheses ||
      /:\d+(?::\d+)?$/.test(symbol)
    ) {
      fail(`Invalid related symbol: ${row[0]}`);
      continue;
    }
    if (
      !pathMatch || /[\\\x00-\x1f]/.test(path) || /^[a-z]:/i.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      /:\d+(?::\d+)?$/.test(path)
    ) {
      fail(`Invalid related symbol file: ${row[1]}`);
      continue;
    }
    const type = row[2];
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(type) || !allowedTypes.has(type)) {
      fail(`Invalid related symbol type: ${type}`);
      continue;
    }
    const key = `${path}\0${symbol}`;
    if (seen.has(key)) fail(`Duplicate related symbol: ${path}#${symbol}`);
    seen.add(key);
    if (!sourceFileExists(root, path, revision))
      fail(`Source file does not exist with exact case: ${path}`);
  }
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
  const repo = gitInRepo(cwd, "rev-parse", "--show-toplevel");
  if (!repo) {
    console.error(
      "Error: --repo or current directory is not inside a Git worktree",
    );
    process.exitCode = 2;
    return;
  }
  const root = realpathSync(repo);
  let allowedSymbolTypes;
  try {
    allowedSymbolTypes = loadSymbolTypes();
  } catch (err) {
    fail(`Invalid symbol type catalog: ${err.message}`);
    finish();
    return;
  }
  if (opts.sourceRevision &&
    gitInRepo(root, "cat-file", "-t", opts.sourceRevision) !== "commit") {
    fail(`Source revision is not a local commit: ${opts.sourceRevision}`);
    finish();
    return;
  }
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

  const { visible, headers, bodies } = readSections(lines);
  visible.forEach((line, index) => {
    if (index > 0 && /^#{1,6} /.test(line) && !/^## /.test(line)) {
      fail(
        `Unexpected Markdown heading on line ${index + 1}; only the fixed section headings are allowed`,
      );
    }
  });
  const requiredHeaders = headers.filter((header) => header.title !== RELATED_SYMBOLS);
  if (
    requiredHeaders.length !== SECTIONS.length ||
    requiredHeaders.some((h, i) => h.title !== SECTIONS[i])
  ) {
    fail(
      `Sections must appear exactly once in this order: ${SECTIONS.join(" -> ")}`,
    );
  }
  if (headers.filter((header) => header.title === RELATED_SYMBOLS).length > 1)
    fail("Related Symbols section must appear at most once");
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
  validateRelatedSymbols(
    bodies.get(RELATED_SYMBOLS),
    root,
    opts.sourceRevision,
    allowedSymbolTypes,
  );

  const remoteUrl = gitInRepo(root, "remote", "get-url", opts.remote);
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
    if (gitInRepo(root, "cat-file", "-t", parsed.sha) !== "commit") {
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
      `PASS: ADR structure, source files, local commits, and remote URL format: ${file}`,
    );
    console.log(
      "NOTE: Human review is still required for facts, symbol declarations, ASD-STE100, and remote URL reachability.",
    );
  }
}

export function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function gitList(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean);
}
export function isAncestor(a, b) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" })
      .status === 0
  );
}

export function validateAdrs(revision, paths) {
  const entries = gitList(
    "ls-tree",
    "-r",
    "-z",
    revision,
    "--",
    "docs/adr/",
  ).map((entry) => {
    const tab = entry.indexOf("\t");
    const [mode, type, object] = entry.slice(0, tab).split(" ");
    return { mode, type, object, path: entry.slice(tab + 1) };
  });
  const files = entries.map((entry) => entry.path);
  const selected = paths ?? files.filter((path) => path.endsWith(".md"));
  if (selected.length === 0) return [];

  const sourceRevision = git("rev-parse", "--verify", `${revision}^{commit}`);
  const validator = fileURLToPath(import.meta.url);
  const gitDir = git("rev-parse", "--absolute-git-dir");
  const snapshot = realpathSync(mkdtempSync(join(tmpdir(), "adr-validation-")));
  const remote = process.env.ADR_REMOTE || "origin";
  const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: snapshot };

  try {
    for (const entry of entries) {
      const target = join(snapshot, entry.path);
      if (entry.type === "commit") {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const content = execFileSync("git", ["cat-file", "blob", entry.object], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (entry.mode === "120000")
        symlinkSync(content.toString("utf8"), target);
      else writeFileSync(target, content);
    }

    return selected.map((path) => {
      const result = spawnSync(
        process.execPath,
        [validator, path, "--repo", snapshot, "--remote", remote,
          "--source-revision", sourceRevision],
        { cwd: snapshot, env, encoding: "utf8" },
      );
      if (result.status !== 0) {
        const message =
          result.error?.message ||
          result.stderr?.trim() ||
          result.stdout?.trim() ||
          "ADR validator failed";
        return { path, links: [], errors: [message] };
      }

      const lines = readFileSync(join(snapshot, path), "utf8").split("\n");
      const { bodies } = readSections(lines);
      const links = bodies.get("Implementation Commit")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseCommitURL(line.slice(2).trim()).sha);
      const changedAt = git(
        "log",
        "--no-renames",
        "--format=%H",
        "-n",
        "1",
        revision,
        "--",
        path,
      );
      const errors = [];
      for (const linked of links) {
        if (!changedAt || linked === changedAt || !isAncestor(linked, changedAt)) {
          errors.push(
            `${linked} must be an earlier commit in the history of the last ADR change.`,
          );
        }
      }
      return { path, links, errors };
    });
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
