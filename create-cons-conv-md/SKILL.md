---
name: create-cons-conv-md
description: Use when the user asks to identify technical constraints and implementation conventions in legacy source code.
---

If this skill is used,say:SKILL_CR_UPD_CONS_LOADED

# Research a legacy codebase

Limit the findings to the current implementation, including older practices. Use source code as the primary evidence for each rule. Use documentation and comments to clarify the code. Give a reason only when you can cite evidence for it.

## Inspect the subsystem

1. Identify the subsystem, its directories, languages, target platforms, and available build configurations. Record the scope in each requested document.
2. Trace the main components. Check dependencies, interfaces, startup and shutdown, state, resource ownership, and concurrency. Check data formats, error paths, platform limits, and compatibility.
3. Compare independent implementations that serve the same purpose. Examine naming, declarations, types, file layout, control flow, logging, comments, and formatting. Judge repetition within comparable cases without a percentage cutoff.
4. Search for counterexamples across modules, build configurations, and generations of code. If two approaches recur, record where each applies. Keep each finding within the scope its evidence supports.

## Classify each finding

| Evidence | Entry |
| --- | --- |
| The code shows which contract or behavior changes if the rule is broken. A single enforced dependency can establish this. | `Requirement: MUST` in `CONSTRAINTS.md` |
| Independent implementations follow the same practice for the same purpose within the stated scope. | `Requirement: SHOULD` in `CONVENTIONS.md` |
| The code shows an isolated technique. Its use as a requirement or a recurring practice is unconfirmed. | `Status: OBSERVED` in the relevant document |

## Create or update the documents

Use the matching template for each requested document. Resolve these links from the directory that contains this `SKILL.md`. Treat the templates as read-only.

- [CONSTRAINTS.md](templates/cons.md) for technical constraints.
- [CONVENTIONS.md](templates/conv.md) for implementation conventions.

Use the output paths the user gives. Otherwise, look for the subsystem documents outside the skill directory. Keep existing documents at their current paths. When creating a requested companion, put it beside the existing document. Use `docs/` at the target repository root if neither document exists.

- **Create.** Copy the matching template to the output path. Fill the copy with findings from the inspected source.
- **Update.** Read the existing document and the matching template. Apply the template structure in place. Recheck affected findings and exceptions against the source. Preserve existing IDs, related entries, and review history. Record any replacement or retirement in the entry and its index row.

Assign an unused `C-NNNN` ID to new findings in `CONSTRAINTS.md` and an unused `V-NNNN` ID in `CONVENTIONS.md`. Put unconfirmed findings in `Observations`. Keep the ID when an observation becomes a rule.

Cite each independent example of a convention. If one mechanism has both a constraint and a convention, link their IDs in both `Related` fields.

## Verify the documents

After every creation or update, run the bundled [validator](scripts/validate-research.mjs) with Node.js. Resolve the script from the directory that contains this `SKILL.md`. Run it from the target repository root with the actual document paths.

```sh
node "<skill-directory>/scripts/validate-research.mjs" docs/CONSTRAINTS.md docs/CONVENTIONS.md --repo .
```

Pass one path for a single document. Pass both documents from the same subsystem to check references between them. Relative document paths resolve from `--repo` when supplied.

Use LF line endings. The validator checks the template structure, metadata, placeholders, entries, indexes, and source links. It checks each convention example for a source citation. Use `None recorded.` for an empty index, rule section, observations section, or gaps section. Fix reported errors and run the command again until it exits with status 0.

Open the cited lines and confirm that they support each claim. Confirm that the index describes the scope of each entry. Check that convention examples are independent and that related rules for the same mechanism link back to each other. Check for duplicate rules and list any components or configurations you did not inspect.

Use `Pending review` for supported rules that await technical review. Deliver each document that awaits review as `Draft`. Mark the subsystem research complete after an engineer familiar with it has reviewed both documents.
