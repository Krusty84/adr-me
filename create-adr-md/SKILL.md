---
name: create-adr-md
description: Use when the user asks to record an accepted technical decision.
---

If this skill is used,say:SKILL_CR_UPD_ADR_LOADED

## Goal

Record an Architecture Decision Record (ADR) and link it to its implementation commit.An ADR records **why** a solution was selected, not a transcript or a change log. Use one ADR per decision, one decision can span multiple implementation commits.

## Files

- Template: `templates/adr.md` (relative to this `SKILL.md`).
- Validator: `scripts/validate-adr.mjs` (relative to this `SKILL.md`).
- ADR output: `<repository>/docs/adr/NNNN-short-title.md`.

Use the template without adding, deleting, renaming, or reordering its attributes or sections. Replace all placeholders. Do not edit the template to create an ADR.

## Mandatory writing rules

- Write **all ADR prose in English**, regardless of the agent session language.
- **Write in ASD-STE100, Issue 9.** Use its approved vocabulary and writing rules where applicable. Keep established code terms, API names, and identifiers unchanged.
- **Be so brief every word you write costs you $1,000.**
- Keep the title within 120 characters. Keep the title and the six prose sections within 350 words.
- Use short, direct sentences, one idea per sentence, and active voice.
- State verifiable facts. Do not invent the task, intent, reasons, alternatives, risks, or outcomes.
- Use `Not recorded.` for a missing _Context_, _Rationale_, _Alternatives_, or _Consequences_ item. Do not invent evidence to complete a section.
- The _Decision_ and _Implementation_ sections must contain supported facts. If the decision cannot be identified, stop and request human input.
- Review English, length limits, and ASD-STE100 separately. The validator checks structure, commit links, and source file paths.

## Fixed document contract

Use the required heading and attribute order in `templates/adr.md`:

1. `# ADR-NNNN: Title`
2. `**Status:** Accepted`
3. `**Date:** YYYY-MM-DD`
4. `**Record Type:** Agent-Session | Retrospective` (choose one)
5. `**Evidence:** Agent Session | Git History | Manual | Mixed` (choose one)
6. `## Context`
7. `## Decision`
8. `## Rationale`
9. `## Alternatives`
10. `## Consequences`
11. `## Implementation`
12. `## Related Symbols`
13. `## Implementation Commit`

The `Date` is the ADR creation date, not the implementation date. `Status: Accepted` means the user approved the **documented decision now**; it does not claim that a historical ADR existed.

Use `Record Type: Agent-Session` for a decision captured during implementation. Use `Retrospective` when reconstructing a decision from past work. `Evidence` identifies the principal source: `Agent Session`, `Git History`, `Manual`, or `Mixed`.

In `Implementation Commit`, write one or more bullet lines containing only full HTTPS commit URLs. Each URL must include the full commit SHA (40 or 64 hex characters), for example:

`- https://github.com/owner/repo/commit/0123456789abcdef0123456789abcdef01234567`

Do not add `Verified At` or `Scope` yet: these are reserved for a future ADR freshness workflow. Never use `Status` or `Record Type` as a freshness indicator.

## Mode A: Agent-Session

1. Review the active agent session, the selected changes, tests, and `git diff`. Identify one technical decision and its supporting evidence.
2. Draft the ADR **outside** `docs/adr/`, using the fixed template. Do not claim the decision was made if it was only suggested.
3. Show the draft to the user. Require explicit approval of the decision, the wording, and the intended Git commits before changing history.
4. Commit only the approved implementation files. Do **not** include the ADR in this implementation commit. Do not stage unrelated files. Never amend, reset, rebase, force-push, or push without separate approval.
5. Read the full implementation SHA from Git after the commit. Identify the repository web URL from a verified Git remote. Use the forge's commit URL format; do not guess unsupported hosts or project paths.
6. Create `docs/adr/NNNN-short-title.md` with the approved text, `Status: Accepted`, `Record Type: Agent-Session`, and all implementation commit URLs. If the code spans several commits, include each relevant URL.
7. Run the bundled validator. Resolve all errors. Independently review ASD-STE100 and factual accuracy. If approval-sensitive wording changes, request approval again.
8. Commit only the approved ADR file as a second commit. Report both commit SHAs and the ADR path. Do not push without approval.

**Why two commits:** A commit contains the hash of its file tree. An ADR cannot reliably embed the SHA of the same commit that contains it.

## Mode B: Retrospective

1. Ask the user to select a commit, range, change, or component only if it cannot be determined from the request.
2. Inspect relevant `git log`, `git show`, `git blame`, tests, existing documentation, and available PRs/issues. Do not assume those external sources are available.
3. Group commits by _technical decision_. Do not create one ADR for every commit.
4. Record only confirmed behavior and documented reasons. Distinguish code facts from historical intent. Put `Not recorded.` when reasons or rejected alternatives are unknown.
5. Draft the same template using `Record Type: Retrospective` and the correct `Evidence` value. Add direct URLs to the actual implementation commits.
6. Request approval of the decision, wording, and ADR-only commit. After approval, set `Status: Accepted` and the current ADR creation date.
7. Validate, review ASD-STE100, and commit only the new ADR. Do not rewrite historical commits or alter their content. Do not push without approval.

## Implementation link rules

- The URL must point to the exact implementation **commit**, not a branch, tag, pull request, directory, or diff page.
- Resolve the project location from a configured Git remote, not from assumptions. Ensure the SHA exists locally as a commit object.
- Use the full SHA. Include multiple URLs when the decision spans multiple commits.
- If the remote is missing, the web URL is unknown, or a commit cannot be verified, stop before committing the ADR. Ask the user for a verifiable repository URL or correct Git history.
- Rebase, amend, and cherry-pick can change SHAs. After such operations, rerun validation and update affected ADR URLs in a **new** commit. A local object check does not prove that a URL is reachable on the server.

## Source symbol links

Use the optional heading `## Related Symbols` at most once, after the metadata and at any position among the standard sections. When creating an ADR, put it before `Implementation Commit`. Omit it if no symbol links are confirmed. An absent or empty section is valid. Existing ADRs need no migration. This section is outside the existing prose word limit.

- Link functions, methods, classes, interfaces, variables, constants, and properties that implement the decision. Read the source to verify each declaration, its qualified name, and its relevance. Do not infer a link from a name alone.
- Put one identifier in inline code on each Markdown list item: `relative/path#QualifiedName`. Use repository-relative paths, `/` separators, and exact path and symbol case. Each path must identify an existing regular file. Do not use absolute paths, `.` or `..` path segments, call parentheses, or source line numbers.
- An English description is optional. Put it after the identifier or on indented continuation lines. Do not repeat an identifier within one ADR.
- One ADR can link several symbols. Several ADRs can link the same symbol. Update affected links after a file move or symbol rename.
- Local variables, parameters, and overloaded methods need a separate disambiguation rule. Until that rule exists, use prose mentions for them.

```markdown
## Related Symbols

- `src/pressure/Service.ts#PressureService.calculate` — pressure calculation.
- `src/pressure/Service.ts#PressureService.flowRate`
  — input flow rate.
- `src/pressure/limits.ts#MAX_PRESSURE` — pressure limit.
```

In other sections, use inline code for source names, such as `PressureService.calculate()` or `MAX_PRESSURE`. Preserve source names; include the class name for methods where possible. Call parentheses are allowed in prose. These mentions supply search candidates. A name without a path is ambiguous when declarations share that name. Exact links in `Related Symbols` take priority over inferred matches.

### IDE consumer contract

Future IDE integration must show valid links through CodeLens or Hover, display ADR IDs such as `ADR-0012`, and open the selected ADR. Where possible, open its reference line. Refresh links after ADR or source changes. Keep ADRs without this section available for full-text search. Link errors must not prevent opening or editing an ADR.

The validator checks link syntax, duplicates, and source files. The agent verifies declarations. Automatic missing-symbol and ambiguity diagnostics need a language-aware resolver; that resolver and the VS Code extension are separate work.

## Validation (mandatory)

The validator is part of this skill:

`scripts/validate-adr.mjs`

### Execution

1. Determine the directory that contains this `SKILL.md`.
2. Resolve `scripts/validate-adr.mjs` relative to that directory.
3. Find the root of the target Git repository.
4. Run the validator from the repository root.
5. Pass the ADR path, repository root, and Git remote.
6. Do not assume a fixed skill installation path.
7. Do not use a validator from another skill installation.

The skill can be installed globally or inside a repository.

### Validation Rules

The validator checks:

- ADR path, filename, and ID.
- Required attributes and allowed values.
- Required section structure and order, with at most one optional `Related Symbols` section.
- Required content and valid dates.
- Unfilled fields from the bundled template.
- HTTPS implementation commit URLs.
- Git remote identity.
- Existence of local implementation commits.
- Source link syntax, duplicate identifiers, and source files with exact path case.

### Completion Requirements

1. Run validation after each ADR change.
2. Correct all errors.
3. Repeat validation until it passes.
4. Review factual accuracy, linked declarations, ambiguity, and ASD-STE100 compliance.
5. Verify implementation commit URLs.
6. Do not commit an invalid ADR.

The validator cannot prove factual accuracy, symbol existence or unique resolution,
full ASD-STE100 compliance, or URL reachability.

Run the **same validator** in a pre-commit hook and CI to enforce the contract outside the agent. Do not treat a successful validation as user approval.
