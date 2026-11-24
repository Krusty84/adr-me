# CONSTRAINTS: <Subsystem name>

**Status:** <Draft | Accepted>
**Date:** YYYY-MM-DD
**Record Type:** <Agent-Session | Retrospective>
**Evidence:** <Source files and any supporting tests, build configuration, or history.>

## Scope

<Name the repository and subsystem. List the directories, languages, platforms, and build configurations inspected.>

## Constraint index


| ID | Title | Category | Scope | Status | Superseded by |
| --- | --- | --- | --- | --- | --- |
| C-NNNN | <Title> | <Category> | <Scope> | <Entry status> | <Replacement ID or dash> |

## Constraints

### C-NNNN — <Short constraint title>

- **Category:** <Architecture | Interface | Compatibility | Runtime | Lifecycle | State | Concurrency | Memory | Data | Error | Dependency | Build | Security | Performance | Extension | Other>
- **Scope:** <Paths and conditions where the rule applies. Identify exclusions.>
- **Requirement:** MUST
- **Status:** <Pending review | ACTIVE | SUPERSEDED | RETIRED>
- **Rule:** <State one invariant that the code enforces or relies on.>
- **Change implications:** <Identify the contract or behavior that changes if the rule is broken.>
- **Evidence:** [<repository-relative-path>:<line-number>](<path-relative-to-document>#L<line-number>) — <Identify the check, caller, or dependency that proves the rule.>
- **Verification:** <Give the call path, test, or command and the result that confirms the invariant.>
- **Exceptions:** <Cite each exception or reviewed override and its scope, or write "None found in the inspected scope.">
- **Related:** <Give related rule IDs. Link entries for the same mechanism in both directions, or write "Not applicable.">
- **Rationale:** <Give the documented reason and its source, or write "Not recorded.">
- **Owner:** <Person or team, or "Not recorded.">
- **History:** <Give the introduction and review dates if known. For a status change, record the reviewer, reason, and any predecessor or replacement ID.>

## Observations

### C-NNNN — <Short observation title>

- **Status:** OBSERVED
- **Category:** <Category from the index>
- **Scope:** <Where this behavior occurs.>
- **Observation:** <Describe the behavior seen in the source.>
- **Evidence:** [<repository-relative-path>:<line-number>](<path-relative-to-document>#L<line-number>)
- **Open question:** <Identify the evidence needed to establish a dependency.>

## Known gaps and open questions

| ID | Uninspected area or conflicting rule IDs | Missing evidence | Owner | Next action |
| --- | --- | --- | --- | --- |
| GAP-NNN | <Scope or rule IDs> | <What remains unknown> | <Owner or "Not recorded."> | <How to check it> |

## Technical review

**Maintainers:** <Person or team, or "Not recorded.">
**Last reviewed:** <YYYY-MM-DD and reviewer, or "Pending review.">
