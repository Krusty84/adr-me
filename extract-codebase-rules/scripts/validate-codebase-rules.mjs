#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const usage = "Usage: node validate-codebase-rules.mjs <document.md> [companion.md] [--repo <root>]";
const emptySection = "None recorded.";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function visibleText(text) {
  let fence = "";
  let comment = false;
  return text.split("\n").map(line => {
    if (comment) {
      const end = line.indexOf("-->");
      if (end < 0) return "";
      comment = false;
      line = line.slice(end + 3);
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1].startsWith(fence) && !marker[2].trim()) fence = "";
      return "";
    }
    if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = marker[1];
      return "";
    }
    return line.replace(/(`+)(?!`).*?\1(?!`)|<!--.*?(-->|$)/g, (match, ticks, end) => {
      if (ticks) return match;
      comment = !end;
      return "";
    });
  }).join("\n");
}

// Keep the template order. A Map alone would hide duplicate headings or fields.
function blocks(text, delimiter, where) {
  const [intro, ...parts] = text.split(delimiter);
  const items = new Map();
  for (let i = 0; i < parts.length; i += 2) {
    const name = parts[i].trim();
    check(!items.has(name), `${where}: duplicate ${name}`);
    items.set(name, parts[i + 1].trim());
  }
  return { intro: intro.trim(), items };
}

function sameOrder(actual, expected, what) {
  check([...actual.keys()].join("\n") === [...expected.keys()].join("\n"),
    `${what} must appear once in this order: ${[...expected.keys()].join(", ")}`);
}

function fields(text, where, record = false, examples = false) {
  // The convention template puts the examples table between Usage and Exceptions.
  if (examples) text = text.replace(/^(?=\|)/m, "- **Examples:**\n");
  const delimiter = record ? /^- \*\*([^*\n]+):\*\*[ \t]*/gm : /^\*\*([^*\n]+):\*\*[ \t]*/gm;
  const { intro, items } = blocks(text, delimiter, where);
  check(!intro, `${where}: unexpected text before the fields`);
  return items;
}

function checkFields(actual, model, where) {
  sameOrder(actual, model, `${where} fields`);
  for (const [key, sample] of model) {
    const value = actual.get(key);
    check(value, `${where}: empty ${key}`);
    const choices = sample.match(/^<([^<>\n]+\s\|\s[^<>\n]+)>$/);
    if (choices) check(choices[1].split(" | ").includes(value), `${where}: invalid ${key}: ${value}`);
    else if (!sample.includes("<") && sample !== "YYYY-MM-DD") {
      check(value === sample, `${where}: ${key} must be ${sample}`);
    }
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value + "T");
}

function cells(line) {
  const row = line.trim();
  if (!row.startsWith("|") || !row.endsWith("|")) return [];
  return row.slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.replaceAll("\\|", "|").trim());
}

function table(text, model, where) {
  const [heading, separator = "", ...rows] = text.split("\n");
  const expected = cells(model.split("\n")[0]);
  check(cells(heading).join("\n") === expected.join("\n"), `${where}: invalid table columns`);
  const alignment = cells(separator);
  check(alignment.length === expected.length && alignment.every(cell => /^:?-{3,}:?$/.test(cell)),
    `${where}: invalid table separator`);
  check(rows.length, `${where}: empty table`);
  return rows.map(row => {
    const values = cells(row);
    check(values.length === expected.length && values.every(Boolean), `${where}: incomplete table row: ${row}`);
    return values;
  });
}

function sourceLinks(text) {
  const links = [];
  const prose = text.replace(/(`+)(?!`)[^\n]*?\1(?!`)/g, "");
  const start = /(?<![!\\])\[((?:[^\[\]\n]|\[[^\]\n]*\])*)\]\(/g;
  for (const match of prose.matchAll(start)) {
    const offset = match.index + match[0].length;
    let depth = 1;
    let end = offset;
    while (end < prose.length && prose[end] !== "\n" && depth) {
      if (prose[end] === "(") depth++;
      if (prose[end] === ")") depth--;
      end++;
    }
    const target = prose.slice(offset, depth ? end : end - 1);
    if (/:\s*[-+]?\d/.test(match[1]) || /#L\d/.test(target)) {
      check(!depth, `Unclosed source link: ${match[1]}`);
      links.push({ label: match[1], target });
    }
  }
  return links;
}

function checkLink({ label, target }, root, file, counts) {
  const caption = label.match(/^(.+):([1-9]\d*)$/);
  const anchor = target.match(/^([^\s<>\\?#]+)(?:\?plain=1)?#L([1-9]\d*)$/);
  check(caption && anchor && caption[2] === anchor[2], `Invalid source link: [${label}](${target})`);
  const path = caption[1];
  const parts = path.split("/");
  check(!/^[a-z][\w+.-]*:|[\\\x00-\x1f]/i.test(path) && parts.every(p => p && p !== "." && p !== ".."),
    `Invalid repository source path: ${path}`);
  let segments;
  try {
    segments = anchor[1].split("/").map(decodeURIComponent);
  } catch {
    throw new Error(`Invalid encoding in source link: ${target}`);
  }
  check(!/^[a-z][\w+.-]*:/i.test(segments[0]) && segments.every(p => p && !/[/\\\x00-\x1f]/.test(p)),
    `Invalid relative source link: ${target}`);
  check(relative(root, resolve(dirname(file), ...segments)) === path, `Source link does not match path: ${label}`);
  if (!counts.has(path)) {
    let source = root;
    for (const part of parts) {
      check(lstatSync(source).isDirectory() && readdirSync(source).includes(part), `Missing source path with exact case: ${path}`);
      source = join(source, part);
    }
    check(lstatSync(source).isFile(), `Source must be a regular file: ${path}`);
    const lines = readFileSync(source, "utf8").split(/\r\n|[\r\n]/);
    if (lines.at(-1) === "") lines.pop();
    counts.set(path, lines.length);
  }
  check(Number(caption[2]) <= counts.get(path), `Source line outside file: ${label}`);
}

function entries(body, sample, observations, prefix, findings, categories) {
  if (body === emptySection) return;
  const { intro, items } = blocks(body, /^### (.+)$/gm, "Entries");
  check(!intro && items.size, "Expected an entry heading or None recorded.");
  const examples = prefix === "V" && !observations;
  const sampleEntry = blocks(sample, /^### (.+)$/gm, "Template").items.values().next().value;
  const model = fields(sampleEntry, "Template", true, examples);
  for (const [heading, text] of items) {
    const match = heading.match(/^([CV]-\d{4}) — (\S.*)$/);
    check(match && match[1][0] === prefix, `Invalid entry ID or title: ${heading}`);
    const [, id, title] = match;
    check(!findings.has(id), `Duplicate entry ID: ${id}`);
    const values = fields(text, id, true, examples);
    checkFields(values, model, id);
    check(categories.includes(values.get("Category")), `${id}: invalid category`);
    if (examples) {
      const seen = new Set();
      for (const [example, evidence] of table(values.get("Examples"), model.get("Examples"), `${id} examples`)) {
        const links = sourceLinks(evidence);
        check(links.length, `${id}: each example needs source evidence`);
        seen.add([example, ...links.map(link => link.label).sort()].join("\n"));
      }
      check(seen.size >= 2, `${id}: provide independent examples of the convention`);
    } else {
      check(sourceLinks(values.get("Evidence")).length, `${id}: Evidence needs a source line link`);
    }
    const references = values.get("Related")?.match(/\b[CV]-\d+\b/g) ?? [];
    for (const ref of references) check(/^[CV]-\d{4}$/.test(ref), `${id}: invalid related ID ${ref}`);
    findings.set(id, { title, status: values.get("Status"), category: values.get("Category"), references });
  }
}

function checkIndex(body, model, findings) {
  const rows = body === emptySection ? [] : table(body, model, "Index");
  const indexed = new Set();
  const label = cell => cell.replace(/^\[([^\]]+)\]\(#[^)]+\)$/, "$1").replace(/^`([^`]+)`$/, "$1");
  for (const row of rows) {
    const [id, title, category, , status, replacement] = row.map(label);
    const entry = findings.get(id);
    check(entry && !indexed.has(id), `Index: missing or duplicate entry for ${id}`);
    check(label(entry.title) === title && entry.category === category && entry.status === status, `Index disagrees with entry ${id}`);
    if (status === "SUPERSEDED" || !/^[-–—]$/.test(replacement)) {
      check(/^[CV]-\d{4}$/.test(replacement) && replacement !== id, `Index: invalid replacement for ${id}`);
      entry.references.push(replacement);
    }
    indexed.add(id);
  }
  for (const id of findings.keys()) check(indexed.has(id), `Missing index row for ${id}`);
}

function validate(file, root, counts) {
  check(lstatSync(file).isFile(), `Expected a regular document: ${file}`);
  file = realpathSync(file);
  const path = relative(root, file);
  check(path !== ".." && !path.startsWith("../") && !isAbsolute(path), "Document is outside the repository");
  const raw = readFileSync(file, "utf8");
  check(!raw.includes("\r"), "Use LF line endings");
  const text = visibleText(raw);
  const title = text.match(/^# (CONSTRAINTS|CONVENTIONS): (\S[^\n]*)\n/);
  check(title, "Expected a CONSTRAINTS or CONVENTIONS title on the first line");
  const type = title[1];
  if (["CONSTRAINTS.md", "CONVENTIONS.md"].includes(basename(file))) {
    check(basename(file) === type + ".md", "Document title and filename disagree");
  }
  const templateName = type === "CONSTRAINTS" ? "cons.md" : "conv.md";
  const template = visibleText(readFileSync(new URL(`../templates/${templateName}`, import.meta.url), "utf8"));
  const placeholders = template.match(/<[^<>\n]+>/g);
  const unfilled = placeholders.find(value => text.includes(value));
  check(!unfilled, `Unfilled template placeholder: ${unfilled}`);
  const split = input => blocks(input.slice(input.indexOf("\n") + 1), /^## (.+)$/gm, "Sections");
  const doc = split(text);
  const model = split(template);
  sameOrder(doc.items, model.items, "Sections");
  const [, index, rules, observed, gaps, review] = model.items.keys();
  for (const [name, body] of doc.items) {
    check(body && !/^#{1,2} |^#{4,6} /m.test(body), `${name}: empty section or unexpected heading`);
    if (name !== rules && name !== observed) check(!/^### /m.test(body), `Unexpected heading in ${name}`);
  }
  const metadata = fields(doc.intro, "Metadata");
  checkFields(metadata, fields(model.intro, "Template"), "Metadata");
  check(validDate(metadata.get("Date")), "Invalid document date");
  const reviewed = fields(doc.items.get(review), review);
  checkFields(reviewed, fields(model.items.get(review), review), review);
  const last = reviewed.get("Last reviewed");
  if (/^Pending review\.?$/.test(last)) check(metadata.get("Status") === "Draft", "Accepted documents require a review date and reviewer");
  else {
    const date = last.match(/\b\d{4}-\d{2}-\d{2}\b/);
    check(date && validDate(date[0]) && /[\p{L}\p{N}]/u.test(last.replace(date[0], "")), "Invalid Last reviewed date or reviewer");
  }
  const categories = model.items.get(rules).match(/^- \*\*Category:\*\* <(.+)>$/m)[1].split(" | ");
  const findings = new Map();
  const prefix = type === "CONSTRAINTS" ? "C" : "V";
  entries(doc.items.get(rules), model.items.get(rules), false, prefix, findings, categories);
  entries(doc.items.get(observed), model.items.get(observed), true, prefix, findings, categories);
  checkIndex(doc.items.get(index), model.items.get(index), findings);
  if (doc.items.get(gaps) !== emptySection) {
    const ids = new Set();
    for (const [id] of table(doc.items.get(gaps), model.items.get(gaps), gaps)) {
      check(/^GAP-\d{3}$/.test(id) && !ids.has(id), `Invalid or duplicate gap ID: ${id}`);
      ids.add(id);
    }
  }
  for (const link of sourceLinks(text)) checkLink(link, root, file, counts);
  return { prefix, findings, file };
}

function main() {
  let args;
  let cwd;
  try {
    args = parseArgs({ allowPositionals: true, options: { repo: { type: "string" }, help: { type: "boolean", short: "h" } } });
    if (args.values.help) return console.log(usage);
    check(args.positionals.length >= 1 && args.positionals.length <= 2, "Provide one document or a pair");
    cwd = realpathSync(args.values.repo ?? ".");
    check(lstatSync(cwd).isDirectory(), "--repo must identify a directory");
  } catch (error) {
    console.error(error.message + "\n" + usage);
    process.exitCode = 2;
    return;
  }
  const discovered = args.values.repo ? null : spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const root = discovered?.status === 0 ? realpathSync(discovered.stdout.trim()) : cwd;
  const counts = new Map();
  const documents = new Map();
  for (const path of args.positionals) {
    try {
      const doc = validate(resolve(cwd, path), root, counts);
      check(!documents.has(doc.prefix), "Supply at most one document of each type");
      documents.set(doc.prefix, doc);
    } catch (error) {
      throw new Error(`${path}: ${error.message}`);
    }
  }
  for (const doc of documents.values()) {
    for (const [id, entry] of doc.findings) {
      for (const ref of entry.references) {
        const target = documents.get(ref[0]);
        check(!target || target.findings.has(ref), `${doc.file}: ${id} refers to missing ${ref}`);
      }
    }
  }
  for (const doc of documents.values()) console.log(`PASS: ${doc.file}`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
