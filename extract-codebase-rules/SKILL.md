---
name: extract-codebase-rules
description: Use when the user asks to identify technical constraints or implementation conventions in legacy source code, or to create or update CONSTRAINTS.md or CONVENTIONS.md.
---

If this skill is used,say:SKILL_EXTR_CODE_RULES_LOADED

## Goal

Show engineers which rules a subsystem depends on and which practices its implementations share. Record the scope and source evidence for each finding.

## Files

- Template for technical constraints: `templates/cons.md` (relative to this `SKILL.md`).
- Template for implementation conventions: `templates/conv.md` (relative to this `SKILL.md`).
- Validator: `scripts/validate-codebase-rules.mjs` (relative to this `SKILL.md`).
- CONSTRAINTS.md output: `<repository>/docs/CONSTRAINTS.md`.
- CONVENTIONS.md output: `<repository>/docs/CONVENTIONS.md`.

Use the templates without adding, deleting, renaming, or reordering its attributes or sections. Replace all placeholders. Do not edit the templates.

## Mandatory writing rules

- Write both documents in English. Follow ASD-STE100, Issue 9. Use short sentences and active voice. Preserve code identifiers.
- Describe the current implementation. Use source code as the primary evidence. Use tests, build configuration, documentation, comments, and history to clarify what the code does.
- Cite the source line for each finding and exception. Show the repository path and line number in the link text. Make the target relative to the document, as in `[src/cache.js:42](../src/cache.js#L42)` for a document in `docs/`.
- Give a reason only when a source supports it. Use `Not recorded.` for an unknown rationale or owner.

## Fixed document contract

Use the matching template. Keep its headings, fields, and table columns in order. Replace all placeholders in the output. Use LF line endings.

Include these four fields after the title, in the order shown.

1. `Status` — `Draft` or `Accepted`.
2. `Date` — creation or update date in `YYYY-MM-DD` format.
3. `Record Type` — `Agent-Session` for facts captured during implementation or `Retrospective` for facts reconstructed from existing code.
4. `Evidence` — identify the source files and any supporting evidence used.

| Heading order | CONSTRAINTS.md | CONVENTIONS.md |
| --- | --- | --- |
| Title | `# CONSTRAINTS: <Subsystem name>` | `# CONVENTIONS: <Subsystem name>` |
| 1 | `Scope` | `Scope` |
| 2 | `Constraint index` | `Convention index` |
| 3 | `Constraints` | `Conventions` |
| 4 | `Observations` | `Observations` |
| 5 | `Known gaps and open questions` | `Known gaps and open questions` |
| 6 | `Technical review` | `Technical review` |

- **Constraint.** Assign an unused `C-NNNN` ID and set `Requirement` to `MUST`. Cite the check, caller, or dependency that establishes the rule. State what changes if the rule is broken and how to verify it. One enforced dependency can establish a constraint.
- **Convention.** Assign an unused `V-NNNN` ID and set `Requirement` to `SHOULD`. Give at least two examples from independent implementations that serve the same purpose. Cite each example in its table row and state when the practice applies.
- **Observation.** If the evidence shows only an isolated technique, use `OBSERVED` in the relevant document. Use its ID prefix, cite the source, and record the open question.
- Include one index row per rule or observation. Use `None recorded.` for an empty index, rules section, observations section, or gaps section.

## Workflow

Work on the requested document or pair. Use the paths the user gives. Otherwise, locate existing documents for that subsystem outside the skill directory. Place a new companion beside the existing document. Use the default paths when neither exists.

### Inspect the subsystem

1. Record the directories, languages, platforms, and build configurations inspected. Trace dependencies, active library versions, upgrade limits, interfaces, lifecycle, state, and error paths.
2. Compare implementations that serve the same purpose. Inspect naming, file layout, and recurring code patterns. Check other modules and configurations for exceptions. Record where each practice applies.
3. Link a constraint and a convention for the same mechanism in both `Related` fields. Record conflicting evidence and uninspected areas in `Known gaps and open questions`.

### Create

Copy each requested template to its output path. Fill the copy with the findings and their index rows.

### Update

Apply the matching template at the document's current path. Recheck affected entries and exceptions against the source. Preserve IDs, related entries, and review history. Keep the ID when an observation becomes a rule. Record a replacement or retirement in both the entry and its index row.

## Validation (mandatory)

### Execution

After each change, run the validator bundled with this skill from the target repository root. Replace `<skill-directory>` with the directory that contains this `SKILL.md`. Use the actual document paths. Relative paths resolve from `--repo`.

For one document, pass its path.

```sh
node "<skill-directory>/scripts/validate-codebase-rules.mjs" docs/CONSTRAINTS.md --repo .
```

For a pair from the same subsystem, pass both paths to check references between documents.

```sh
node "<skill-directory>/scripts/validate-codebase-rules.mjs" docs/CONSTRAINTS.md docs/CONVENTIONS.md --repo .
```

### Validation Rules

- The validator checks the title, field and section order, dates, review fields, template placeholders, and LF line endings.
- It checks entry and gap IDs, categories, requirements, statuses, and index rows. It checks related and replacement IDs against the supplied documents.
- It checks that source links resolve to the stated file and line inside the repository. For each convention, it requires at least two distinct example rows with source links.

### Completion Requirements

1. Correct validation errors and run the command again until it exits with status 0.
2. Read the cited lines. Confirm that they support each claim and that convention examples are independent. Check index scope, reciprocal links, duplicate rules, and gaps. Review the English text against ASD-STE100.
3. Deliver documents awaiting review as `Draft` and mark supported rules awaiting review as `Pending review`. Use `Accepted` and `ACTIVE` only after an engineer familiar with the subsystem reviews the document and the rules concerned. Record the review date and reviewer. Mark the subsystem research complete after both documents have been reviewed.
