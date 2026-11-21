# adr-me

Create Architecture Decision Records (ADRs) and architecture documents with an AI agent.

## What Is This?

adr-me contains two agent skills: [create-adr-md](create-adr-md/SKILL.md) records accepted technical decisions; [create-update-architecture-md](create-update-architecture-md/SKILL.md) describes the current system. Each skill includes a document template and a validator.

## Features

- Record decisions from an agent session or Git history.
- Link ADRs to implementation commits and source symbols.
- Create and update architecture documents with source links and PlantUML context and component diagrams.
- Check document structure, source references, and ADR commit links.
- Check ADRs before pushes to `main` and report code commits without valid ADR links in GitHub Actions.

## Who is it for?

For engineers who use AI agents to record technical decisions and explain system architecture.

## How to install

Requires Git, Node.js 18 or later, and an agent that can follow `SKILL.md` instructions. The validators need no npm packages.

```sh
git clone https://github.com/Krusty84/adr-me.git
```

Copy the complete `create-adr-md/` and `create-update-architecture-md/` directories into the target Git repository root. Keep their templates, scripts, and references.

ADR validation requires a configured Git remote and the implementation commits in local history.

PlantUML is optional. Make `plantuml` available on `PATH` to check diagram syntax. Without it, the architecture validator checks the document and reports that diagram syntax was not checked.

### Optional ADR checks

Merge `.github/` and `.githooks/` from this package into the target repository root. Keep existing files and settings. The hook and GitHub Actions use the validator, template, and type catalog in `create-adr-md/`. Commit the installed files so GitHub Actions can read them.

Run these commands in the target repository on each developer computer:

```sh
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
git update-index --chmod=+x .githooks/pre-push
```

Set `CODE_PATHS` in [.github/scripts/adr-policy.mjs](.github/scripts/adr-policy.mjs) to the target repository's relative code paths, for example `["src/", "tests/"]`. The defaults cover this package's ADR scripts, hook, and tests. An empty or invalid list skips the commit scan. The hook still validates new and changed ADRs.

The hook uses the push remote. GitHub Actions uses `origin` through `ADR_REMOTE` in [.github/workflows/adr-check.yml](.github/workflows/adr-check.yml). Keep `fetch-depth: 0` so the audit has full Git history.

## How to use

Tell the agent to read the required skill's `SKILL.md`. Example requests:

```text
Use create-adr-md to record the accepted decision from this session.
Use create-update-architecture-md to describe the current system in docs/ARCHITECTURE.md.
```

ADRs use `docs/adr/NNNN-short-title.md`. New architecture documents use `docs/ARCHITECTURE.md`; existing documents keep their current path.

Run validation from the target repository root. Replace the example ADR path with your file.

```sh
node create-adr-md/scripts/validate-adr.mjs docs/adr/0001-short-title.md --repo . --remote origin
node create-update-architecture-md/scripts/validate-arch.mjs docs/ARCHITECTURE.md --repo .
```

Review facts and ASD-STE100 wording separately from automated validation.

### ADR workflow

Use one ADR per technical decision. The user can defer a record. For the same decision, update the existing ADR: keep its ID, creation date, and valid links, then add the new facts and commit links.

Approve the decision, text, and intended Git commits first. Commit the implementation before the ADR. For a decision from Git history, use the existing implementation commits. A push requires separate approval.

After the implementation commit, get its full SHA:

```sh
git rev-parse HEAD
```

Use the [ADR template](create-adr-md/templates/adr.md) to create `docs/adr/0042-cache-sync.md`. This example shows the required fields. Replace the facts, date, repository URL, and SHA with verified values.

```markdown
# ADR-0042: Cache synchronization

**Status:** Accepted
**Date:** 2026-11-17
**Record Type:** Agent-Session
**Evidence:** Agent Session

## Context
Concurrent cache updates can conflict.

## Decision
Use a mutex for cache updates.

## Rationale
A queue would add complexity with no benefit for the current workload.

## Alternatives
Not recorded.

## Consequences
Cache updates run one at a time.

## Implementation
Cache updates use the same mutex.

## Implementation Commit
- https://github.com/OWNER/REPO/commit/0123456789abcdef0123456789abcdef01234567
```

Use one HTTPS URL bullet per implementation commit, with a full 40- or 64-character SHA. Each linked commit must precede the commit that last changed the ADR. Keep ADRs as regular files at `docs/adr/NNNN-lowercase-slug.md`.

The optional `Related Symbols` table links declarations to source files and lines. Select types from the [type catalog](create-adr-md/references/types.md). Review the 120-character title limit and the 350-word limit for the title and six prose sections manually.

Validate the ADR, then commit it separately from the implementation:

```sh
node create-adr-md/scripts/validate-adr.mjs docs/adr/0042-cache-sync.md --repo . --remote origin
git add docs/adr/0042-cache-sync.md
git commit -m 'docs: record cache synchronization ADR'
```

After separate push approval:

```sh
git push origin main
```

### Push checks and audit

- The local hook checks direct pushes to `main`. It validates new and changed ADRs in the final pushed tree. Invalid ADRs stop the push.
- The hook checks new non-merge code commits in `CODE_PATHS` from the remote tip to the pushed SHA. The first push checks the full pushed history and all ADRs.
- For commits without valid ADR links, the hook asks for confirmation once. Enter `y` or `yes` to continue. Any other reply, no reply, or end of input stops the push.
- Without a terminal, use `ADR_ALLOW_MISSING=1 git push origin main` to accept missing ADR links. Invalid new or changed ADRs still stop the push. `git push --no-verify` skips the hook.
- GitHub Actions runs after pushes to `main` and on demand. It scans the last 30 non-merge commits for changes in `CODE_PATHS`, including earlier pushes. Set `ADR_SCAN_LIMIT` in the workflow to change the limit (1–500).
- Each code commit without a valid ADR link produces a warning and a commit link. The audit stays successful. Read **Actions → ADR audit (main) → Summary** or the annotation log.
- Checks use committed ADRs and source files. Local file and index changes do not affect the result. An ADR added or updated later can remove warnings in the next audit. Previous run summaries do not change.
- Merge commits are supported. Rebase, amend, and squash can change implementation SHAs. Check and update ADR links after these operations.

Run the ADR regression tests from the `adr-me` checkout root:

```sh
node --test create-adr-md/tests/*.test.mjs
```
