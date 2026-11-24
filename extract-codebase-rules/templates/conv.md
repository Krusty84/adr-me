# CONVENTIONS: <Subsystem name>

**Date:** YYYY-MM-DD
**Record Type:** <Agent-Session | Retrospective>
**Evidence:** <Source files and any supporting tests, build configuration, or history.>

## Scope

<Name the repository and subsystem. List the directories, languages, platforms, and build configurations inspected.>

## Convention index


| ID | Title | Category | Scope | Superseded by |
| --- | --- | --- | --- | --- |
| V-NNNN | <Title> | <Category> | <Scope> | <Replacement ID or dash> |

## Conventions

### V-NNNN — <Short convention title>

- **Category:** <Naming | Variables | Constants | Types | Functions | Classes | ControlFlow | Errors | Logging | Files | Imports | Comments | Formatting | Testing | Patterns | Other>
- **Scope:** <Paths and conditions where the practice applies. Identify exclusions.>
- **Requirement:** SHOULD
- **Rule:** <State one recurring practice. Identify the kind of declaration or operation it applies to.>
- **Usage:** <State when to follow this practice in new or modified code.>

| Example from an independent implementation | Evidence |
| --- | --- |
| `<name or short code excerpt>` | [<repository-relative-path>:<line-number>](<path-relative-to-document>#L<line-number>) |
| `<another name or short code excerpt>` | [<repository-relative-path>:<line-number>](<path-relative-to-document>#L<line-number>) |

- **Exceptions:** <Cite counterexamples. Give the scope or condition that selects each variant, or write "None found in the inspected scope.">
- **Related:** <Related rule IDs. Identify any constraint or reviewed local override that takes precedence, or write "Not applicable.">
- **Rationale:** <Give the documented reason and its source, or write "Not recorded.">

## Observations

### V-NNNN — <Short observation title>

- **Category:** <Category from the index>
- **Scope:** <Where this technique occurs.>
- **Observation:** <Describe the specific declaration or implementation seen in the source.>
- **Evidence:** [<repository-relative-path>:<line-number>](<path-relative-to-document>#L<line-number>)
- **Open question:** <Identify comparable implementations that still need inspection.>

## Known gaps and open questions

| ID | Uninspected area or conflicting rule IDs | Missing evidence | Next action |
| --- | --- | --- | --- |
| GAP-NNN | <Scope or rule IDs> | <What remains unknown> | <How to check it> |
