---
name: create-update-architecture-md
description: Use when the task is to create or update an ARCHITECTURE.md document that explains system structure, key modules, data flow, and major technical decisions. Do not use for lightweight README edits or changelog work.
---

If this skill is used,say:SKILL_CR_UPD_ARCH_LOADED

## Goal

Explain the current system to engineers who are new to the repository.

## Files

- Template: `templates/arch.md` (relative to this `SKILL.md`).
- Validator: `scripts/validate-arch.mjs` (relative to this `SKILL.md`).
- ARCHITECTURE.md output: `<repository>/docs/ARCHITECTURE.md`.

Use the template without adding, deleting, renaming, or reordering its attributes or sections. Replace all placeholders. Do not edit the template to create an ADR.

## Mandatory writing rules

- Write all ADR prose in English, regardless of the agent session language.
- Write in ASD-STE100, Issue 9. Use its approved vocabulary and writing rules where applicable. Keep established code terms, API names, and identifiers unchanged.
- Be so brief every word you write costs you $1,000.
- Describe the current structure and behavior. Check the code, tests, and relevant build or runtime configuration. Use existing documentation and user notes to clarify facts.
- Give reasons for design decisions when they are documented. Use applicable ADRs in `docs/adr/` and other verified sources. Keep the text brief and refer to the README for general usage.
- State verifiable facts. Do not invent the task, intent, reasons, alternatives, risks, or outcomes.

## Fixed document contract

Use the required heading and attribute order in `templates/arch.md`:

1. `# ARCH: Title`
2. `**Date:** YYYY-MM-DD`
3. `**Record Type:** Agent-Session | Retrospective` (choose one)
4. `**Evidence:** Agent Session | Git History | Manual | Mixed` (choose one)
5. `## Overview`
6. `## System context`
7. `## Repository structure`
8. `## System components`
9. `## Startup and execution`
10. `## Data and state`
11. `## Key design decisions`
12. `## External dependencies and integrations`
13. `## Known constraints`

The `Date` is the Architecture.md creation/or update date, not the implementation date. `Status: Accepted` means the user approved the document.

Use `Record Type: Agent-Session` for a architecture description captured during implementation. Use `Retrospective` when reconstructing a architecture description from past work. `Evidence` identifies the principal source: `Agent Session`, `Git History`, `Manual`, or `Mixed`.

## Document requirements

Use the exact title, section headings, and order from [templates/arch.md](templates/arch.md). Fill each section and replace all placeholders in the document.

- Use confirmed facts in `Overview`, `System context`, and `System components`. If evidence is missing for one of these sections, ask the user for the facts before you complete the document.
- In the other sections, use `Not recorded.` when evidence is missing. Use `Not applicable.` when a section does not apply. Give a short reason for each note and keep the facts you can confirm.

## Source links

Put a source link next to each key fact that a repository file supports. Check the line in the current file. Use the repository path and line number as the link text. Make the target path relative to the document's directory. For Markdown targets, put `?plain=1` before the line anchor.

In `docs/ARCHITECTURE.md`, use links such as `[src/main.ts:42](../src/main.ts#L42)` and `[docs/adr/0001-storage.md:7](adr/0001-storage.md?plain=1#L7)`.

## Workflow

Use **Update** for an existing `ARCHITECTURE.md` and **Create** for a new document. Use the path the user gives to find an existing document. If the request leaves several possible files, ask which one to update.

### Create

1. Inspect the repository. Identify the system boundary, components, entry points, and data flow.
2. Fill the template in `docs/ARCHITECTURE.md`. Add the two diagrams and complete the checks below.

### Update

1. Read the existing document and check its facts against the current code and other evidence.
2. Keep the document at its current path. Put confirmed facts in the template structure. Correct obsolete claims, links, and diagrams. Fill missing sections and complete the checks below.

## PlantUML diagrams

- Put the context diagram in `System context` and the component diagram in `System components`. Add more diagrams only if the user requests them.
- Put each diagram in its own top-level CommonMark fenced code block. Use matching backtick or tilde fences and set the info string to `plantuml` in any letter case. Put the explanation next to the diagram in a separate paragraph.
- Put exactly one `@startuml` and one `@enduml` around each diagram. Use built-in PlantUML syntax and omit external directives such as `!include`, `!includeurl`, `!include_once`, `!include_many`, and `!import`. Deliver the diagrams as embedded Markdown source only.

## Completion checks

Resolve `scripts/validate-arch.mjs` relative to this `SKILL.md`. Run it from the target repository root after each document change.

```sh
node "<skill-directory>/scripts/validate-arch.mjs" docs/ARCHITECTURE.md --repo .
```

For an existing document, pass its current path. The validator requires Node.js 18+ and a local Git worktree. It checks the template structure, placeholders, source paths and lines, and PlantUML blocks.

1. Correct all validation errors and repeat the check until it passes. Exit code `1` means document errors. Exit code `2` means invalid arguments or an unavailable Git worktree.
2. The validator uses `plantuml` from `PATH` to check each diagram through stdin in `-syntax` mode. It uses the installed version and warns if the version is older or unknown. PlantUML 1.2026.4 or newer is recommended.
3. If PlantUML is unavailable, the validator continues the document checks and warns that diagram syntax validation was skipped. Report the warning and suggest a future installation of PlantUML 1.2026.4 or newer. Warnings allow exit code `0` when the document checks pass.
4. Review the facts, source lines, and English prose for ASD-STE100 compliance.

## Validation (mandatory)

The validator is part of this skill:

`scripts/validate-arch.mjs`

### Execution

1. Determine the directory that contains this `SKILL.md`.
2. Resolve `scripts/validate-arch.mjs` relative to that directory.
3. Find the root of the target Git repository.
4. Run the validator from the repository root.
5. Pass the ARCHITECTURE.md path, repository root.
6. Do not assume a fixed skill installation path.
7. Do not use a validator from another skill installation.

The skill can be installed globally or inside a repository.

### Validation Rules

The validator checks:

- ARCHITECTURE.md path, filename, and ID.
- Required attributes and allowed values.
- Required section structure and order, with at most one optional `Related Symbols` section.
- Required content and valid dates.
- Unfilled fields from the bundle