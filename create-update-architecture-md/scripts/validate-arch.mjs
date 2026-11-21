#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Strict, offline architecture schema and source verification. Node.js 18+; no dependencies.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEMPLATE = readFileSync(new URL("../templates/arch.md", import.meta.url), "utf8");
const SECTIONS = [...TEMPLATE.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
const TEMPLATE_PLACEHOLDERS = TEMPLATE.match(/<[^<>\n]+>/g) ?? [];
const DIAGRAM_SECTIONS = ["System context", "System components"];
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}
function usage() {
  console.log(
    "Usage: node validate-arch.mjs <ARCHITECTURE.md> [--repo <path>]",
  );
  console.log("Requires a local Git repository. PlantUML is optional.");
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--repo") {
      if (i + 1 >= args.length) throw Error(`Missing value for ${arg}`);
      repo = args[++i];
    } else if (arg.startsWith("-")) throw Error(`Unknown option: ${arg}`);
    else if (file !== null) throw Error("Provide exactly one ARCHITECTURE file");
    else file = arg;
  }
  if (!file) throw Error("Missing ARCHITECTURE filename");
  return { file, repo };
}
function isPlaceholder(s) {
  return TEMPLATE_PLACEHOLDERS.some((placeholder) => s.includes(placeholder));
}

function outsideFences(lines, blocks = []) {
  let fence = null;
  let listIndent = null;
  const visible = lines.map((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker && marker[1][0] === fence.marker[0] &&
        marker[1].length >= fence.marker.length && !marker[2].trim()
      ) {
        fence.end = index;
        blocks.push(fence);
        fence = null;
      } else {
        const spaces = line.match(/^ */)[0].length;
        fence.lines.push(line.slice(Math.min(spaces, fence.indent)));
      }
      return "";
    }
    const indent = line.match(/^ */)[0].length;
    if (line.trim() && listIndent !== null && indent < listIndent) listIndent = null;
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = {
        marker: marker[1], info: marker[2].trim(), line: index, end: null,
        indent, topLevel: listIndent === null, lines: [],
      };
      return "";
    }
    const item = line.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/);
    if (item) listIndent = item[0].length;
    return line;
  });
  if (fence) blocks.push(fence);
  return visible;
}
function readSections(lines) {
  const blocks = [];
  const visible = outsideFences(lines, blocks);
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
  return { visible, headers, bodies, blocks };
}
function readSourceFile(root, path) {
  let target = root;
  for (const part of path.split("/")) {
    if (
      !lstatSync(target, { throwIfNoEntry: false })?.isDirectory() ||
      !readdirSync(target).includes(part)
    ) return null;
    target = join(target, part);
  }
  if (!lstatSync(target, { throwIfNoEntry: false })?.isFile()) return null;
  return readFileSync(target);
}
function parseSourceLineLink(label, raw) {
  const caption = label.match(/^([^\\\x00-\x1f]+):([1-9]\d*)$/);
  const target = raw.match(/^([^\s<>\\?#]+)(\?plain=1)?#L([1-9]\d*)$/);
  if (
    !caption || !target || caption[2] !== target[3] ||
    !Number.isSafeInteger(Number(caption[2])) ||
    /^(?:\/|[a-z][\w+.-]*:)/i.test(target[1])
  ) return null;
  try {
    const path = caption[1];
    if (isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === ".."))
      return null;
    const segments = target[1].split("/").map(decodeURIComponent);
    if (segments.some((part) => !part || /[/\\\x00-\x1f]/.test(part))) return null;
    if ((target[2] ?? "") !== (/\.md$/i.test(path) ? "?plain=1" : "")) return null;
    return { path, line: Number(caption[2]), target: segments.join("/") };
  } catch {
    return null;
  }
}
function validateSourceLinks(visible, root, file) {
  const prose = visible.join("\n").replace(/(`+)[\s\S]*?\1(?!`)/g,
    (code) => code.replace(/[^\n]/g, " "));
  prose.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/(?<![!\\])\[(.*?)\]\(/g)) {
      const label = match[1];
      const start = match.index + match[0].length;
      let end = start;
      let depth = 1;
      for (; end < line.length && depth; end++) {
        if (line[end] === "(") depth++;
        else if (line[end] === ")") depth--;
      }
      const raw = line.slice(start, depth ? end : end - 1);
      const literal = line.slice(match.index, end);
      if (!/:\s*[+-]?\d/.test(label) && !/#L\d/.test(raw)) continue;
      const link = depth ? null : parseSourceLineLink(label, raw);
      if (!link) {
        fail(`Invalid source link on line ${index + 1}: ${literal}`);
        continue;
      }
      const path = relative(root, resolve(dirname(file), link.target)).split(sep).join("/");
      if (path === ".." || path.startsWith("../") || isAbsolute(path)) {
        fail(`Source link is outside the Git repository on line ${index + 1}: ${literal}`);
        continue;
      }
      if (path !== link.path) {
        fail(`Source link does not match file on line ${index + 1}: ${literal} (expected ${path})`);
        continue;
      }
      const content = readSourceFile(root, path);
      if (content === null) {
        fail(`Source file does not exist with exact case: ${path}`);
        continue;
      }
      const sourceLines = content.toString("utf8").split(/\r?\n/);
      if (sourceLines.at(-1) === "") sourceLines.pop();
      if (link.line > sourceLines.length)
        fail(`Source link line is outside source file: ${path}:${link.line}`);
    }
  });
}
function validateDiagrams(blocks, headers, visible, root) {
  const diagrams = blocks.filter((block) => /^plantuml(?:\s|$)/i.test(block.info));
  const runnable = [];
  const sections = new Set();
  visible.forEach((line, index) => {
    if (/^ *(?:(?:>\s*|[-+*]\s+|\d+[.)]\s+)+| {4,})(?:`{3,}|~{3,})\s*plantuml(?:\s|$)/i.test(line))
      fail(`PlantUML block on line ${index + 1} must be top-level`);
  });
  for (const block of diagrams) {
    const section = headers.filter((header) => header.line < block.line).at(-1)?.title;
    const location = `${section ?? "document"} on line ${block.line + 1}`;
    const before = errors.length;
    if (!block.topLevel) fail(`PlantUML block in ${location} must be top-level`);
    else sections.add(section);
    if (block.info.toLowerCase() !== "plantuml")
      fail(`PlantUML info string must contain only plantuml in ${location}`);
    if (block.end === null) fail(`PlantUML block in ${location} is not closed`);
    const source = block.lines.join("\n").trim();
    const content = source.replace(/\/'[\s\S]*?'\//g, "").split("\n")
      .map((line) => line.trim()).filter((line) => line && !line.startsWith("'"));
    if (
      content.filter((line) => /^@startuml(?:\s|$)/.test(line)).length !== 1 ||
      content.filter((line) => line === "@enduml").length !== 1 ||
      !/^@startuml(?:\s|$)/.test(content[0] ?? "") || content.at(-1) !== "@enduml"
    ) fail(`PlantUML requires exactly one @startuml and one @enduml in ${location}`);
    if (content.length <= 2) fail(`PlantUML requires meaningful content in ${location}`);
    if (content.some((line) => /^!\s*(?:include\w*|import)\b/i.test(line)))
      fail(`PlantUML external directive in ${location}`);
    if (errors.length === before) runnable.push({ source: `${source}\n`, location });
  }
  for (const section of DIAGRAM_SECTIONS) {
    if (!sections.has(section)) fail(`${section} requires a top-level PlantUML diagram`);
  }

  const options = { cwd: root, encoding: "utf8", timeout: 10000 };
  const probe = spawnSync("plantuml", ["-version"], options);
  if (probe.error || probe.status !== 0) {
    warnings.push("PlantUML is unavailable. Diagram syntax validation was not performed. " +
      "Install PlantUML 1.2026.4 or newer to check diagrams in future.");
    return 0;
  }
  const version = `${probe.stdout}\n${probe.stderr}`.match(/\bPlantUML version (\d+)\.(\d+)\.(\d+)/i);
  if (!version) {
    warnings.push("Cannot determine PlantUML version. Using the installed command.");
  } else {
    const parts = version.slice(1).map(Number);
    const minimum = [1, 2026, 4];
    const difference = parts.findIndex((part, index) => part !== minimum[index]);
    if (difference >= 0 && parts[difference] < minimum[difference])
      warnings.push(`PlantUML ${parts.join(".")} is older than 1.2026.4. Using the installed version.`);
  }
  let checked = 0;
  for (const { source, location } of runnable) {
    const result = spawnSync("plantuml", ["-charset", "UTF-8", "-syntax"], {
      ...options, input: source,
    });
    if (result.error) {
      warnings.push(`PlantUML syntax validation was not performed in ${location}: ${result.error.message}. ` +
        "Install PlantUML 1.2026.4 or newer to check diagrams in future.");
      continue;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.status !== 0 || /\bERROR\b/i.test(output))
      fail(`PlantUML syntax check failed in ${location}: ${output || `exit status ${result.status}`}`);
    else checked++;
  }
  return checked;
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
    console.error("Error: --repo or current directory is not inside a Git worktree");
    process.exitCode = 2;
    return;
  }
  const root = realpathSync(repo);
  const source = isAbsolute(opts.file) ? opts.file : resolve(cwd, opts.file);
  const sourceStat = lstatSync(source, { throwIfNoEntry: false });
  if (sourceStat?.isSymbolicLink()) {
    fail(`ARCHITECTURE file is a symbolic link: ${source}`);
    finish();
    return;
  }
  if (!sourceStat?.isFile()) {
    fail(`ARCHITECTURE file does not exist: ${source}`);
    finish();
    return;
  }
  const file = realpathSync(source);
  const rel = relative(root, file).split(sep).join("/");
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    fail("ARCHITECTURE file must be inside the Git repository");
    finish();
    return;
  }
  const text = readFileSync(file, "utf8");
  if (text.includes("\r")) fail("Use LF line endings");
  const lines = text.replace(/\n$/, "").split("\n");
  if (!/^# ARCHITECTURE: \S.*$/.test(lines[0]))
    fail("First line must be # ARCHITECTURE: Short title");
  const { visible, headers, bodies, blocks } = readSections(lines);
  visible.forEach((line, index) => {
    if (index > 0 && /^#{1,6} /.test(line) && !/^## /.test(line))
      fail(`Unexpected Markdown heading on line ${index + 1}; only the fixed section headings are allowed`);
  });
  if (
    headers.length !== SECTIONS.length ||
    headers.some((header, index) => header.title !== SECTIONS[index])
  ) fail(`Sections must appear exactly once in this order: ${SECTIONS.join(" -> ")}`);
  const firstSectionLine = headers.length ? headers[0].line : lines.length;
  if (isPlaceholder(lines.slice(0, firstSectionLine).join("\n")))
    fail("Document header contains a placeholder");
  for (const section of SECTIONS) {
    const body = bodies.get(section);
    if (!body) {
      fail(`${section} section is missing or empty`);
      continue;
    }
    if (isPlaceholder(body)) fail(`${section} contains a placeholder`);
  }
  validateSourceLinks(visible, root, file);
  const checked = validateDiagrams(blocks, headers, visible, root);
  finish(file, checked);
}
function finish(file, checked = 0) {
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`FAIL: ${errors.length} ARCHITECTURE validation error(s)`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ARCHITECTURE structure and source files: ${file}`);
    if (checked) console.log(`PASS: PlantUML syntax: ${checked} diagram(s)`);
    console.log("NOTE: Human review is still required for facts and ASD-STE100.");
  }
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
