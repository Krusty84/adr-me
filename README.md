# adr-me

Create Architecture Decision Records (ADRs) and architecture documents with an AI agent.

## What Is This?

adr-me contains two agent skills (each skill includes a document template and a validator):
[create-adr-md](create-adr-md/SKILL.md) records accepted technical decisions
[create-update-architecture-md](create-update-architecture-md/SKILL.md) describes the current system. 


## Features

- Install skills for Codex, OpenCode, and Claude Code through an interactive CLI.
- Record decisions from an agent session or Git history.
- Link ADRs to implementation commits and source symbols.
- Create and update `ARCHITECTURE.md` with source links and PlantUML context and component diagrams.
- Check document structure, source references, and ADR commit links.
- Check ADRs and architecture documents before pushes to `main`. 
- Report document errors and code commits without valid ADR links in GitHub Actions.

## Who is it for?

For engineers who use AI agents to record technical decisions and explain system architecture.

## How to install

The installer requires Node.js 22 or later on macOS or Linux. Git is required for project installation, hooks, and GitHub Actions. The installed validators need no npm packages.

The npm package is not published yet. Build an archive from this repository:

```sh
git clone https://github.com/Krusty84/adr-me.git
cd adr-me
npm install --ignore-scripts
npm pack --pack-destination /tmp
```

Run the wizard from the target repository or any of its subdirectories:

```sh
npx --package /tmp/adr-me-0.1.0.tgz adr-me init
```

After npm publication, the registry command will be `npx adr-me init`.

Select one or more agents, the installation scope, and `All` or one skill. Project installation and both skills are the defaults. Skill directories contain the instructions, scripts, templates, and references; tests are excluded.

| Agent | Project | Global |
| --- | --- | --- |
| Codex | `.agents/skills/` | `~/.codex/skills/` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |

Project installation uses the Git repository root. Outside a Git working tree, only global skills are available. The wizard requires an interactive terminal. Cancellation during questions writes no files.

Existing files are kept. Identical files are skipped. A conflicting file skips the whole skill for that agent. Other components can still install. Repeating the same choices adds only missing files; changing existing generated files requires manual conflict resolution. The summary lists installed and skipped components, conflicts, and files to commit. The installer does not stage, commit, or push.

ADR validation requires a configured Git remote and the implementation commits in local history.

PlantUML is optional. Make `plantuml` available on `PATH` to check diagram syntax. Without it, the architecture validator checks the document and reports that diagram syntax was not checked.

### Optional push checks

The wizard offers the local Git pre-push hook and GitHub Actions independently. Both are off by default. They apply to the current repository even when skills are installed globally, and run checks only for the selected skills.

For ADR checks, enter at least one existing code file or directory relative to the repository root, such as `src/`. Enter paths individually. Absolute paths, `..`, glob patterns, and paths outside the repository are rejected.

Check scripts, validators, templates, and references are copied into `.adr-me/`. They work without globally installed skills or the npm cache. The selected paths are written to `.adr-me/.github/scripts/adr-policy.mjs`; the hook and Actions share this configuration.

The hook is installed at the path reported by `git rev-parse --git-path hooks/pre-push` and made executable. An existing different hook or a configured `core.hooksPath` skips hook installation. Existing settings are kept. Hooks are local: run the wizard on each developer computer to connect the committed checks, using the same skills and code paths.

GitHub Actions is written to `.github/workflows/adr-check.yml`. Commit this workflow and `.adr-me/` so Actions can read the checks. A conflicting check dependency prevents installation of its hook or workflow.

The hook uses the push remote. GitHub Actions uses `origin` through `ADR_REMOTE` in the installed workflow. Keep `fetch-depth: 0` so the audit has full Git history.

## How to use

Tell the agent to read the required skill's `SKILL.md`. Example requests:

```text
Use create-adr-md to record the accepted decision from this session.
Use create-update-architecture-md to describe the current system in docs/ARCHITECTURE.md
```

ADRs use `docs/adr/NNNN-short-title.md`. New architecture documents use `docs/ARCHITECTURE.md` existing documents keep their current path.

Run validation from the target repository root. These commands use the Codex project installation. For another agent or global installation, use the corresponding skill directory from the table. Replace the example ADR path with your file.

```sh
node .agents/skills/create-adr-md/scripts/validate-adr.mjs docs/adr/0001-short-title.md --repo . --remote origin
node .agents/skills/create-update-architecture-md/scripts/validate-arch.mjs docs/ARCHITECTURE.md --repo .
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

Use one HTTPS URL bullet per implementation commit, with a full 40- or 64-character SHA. Each linked commit must precede the commit that last changed the ADR. Keep ADRs as regular files at `docs/adr/NNNN-lowercase-slug.md`.

The optional `Related Symbols` table links declarations to source files and lines. Select types from the [type catalog](create-adr-md/references/types.md). Review the 120-character title limit and the 350-word limit for the title and six prose sections manually.

Validate the ADR, then commit it separately from the implementation:

```sh
node .agents/skills/create-adr-md/scripts/validate-adr.mjs docs/adr/0042-cache-sync.md --repo . --remote origin
git add docs/adr/0042-cache-sync.md
git commit -m 'docs: record cache synchronization ADR'
```

After separate push approval:

```sh
git push origin main
```

### Push checks and audit

- The local hook checks direct pushes to `main`. It validates new and changed ADRs in the final pushed tree. Invalid ADRs stop the push.
- On each update to `main`, the hook also validates every tracked file with the exact name `ARCHITECTURE.md`, at any repository path. This includes unchanged documents and their source links. Invalid documents stop the push before any confirmation prompt.
- The hook checks new non-merge code commits in `CODE_PATHS` from the remote tip to the pushed SHA. The first push checks the full pushed history and all ADRs.
- For commits without valid ADR links, the hook asks for confirmation once. Enter `y` or `yes` to continue. Any other reply, no reply, or end of input stops the push.
- Without a terminal, use `ADR_ALLOW_MISSING=1 git push origin main` to accept missing ADR links. Invalid new or changed ADRs still stop the push. `git push --no-verify` skips the hook.
- If no architecture document exists, the hook asks for separate confirmation. Enter `y` or `yes` to continue, any other reply stops the push. Without a terminal, use `ARCH_ALLOW_MISSING=1 git push origin main`. This flag does not allow invalid `ARCHITECTURE.md`. Set both flags if both records are missing.
- GitHub Actions runs after pushes to `main` and on demand. It scans the last 30 non-merge commits for changes in `CODE_PATHS`, including earlier pushes. Set `ADR_SCAN_LIMIT` in the workflow to change the limit (1–500).
- Each code commit without a valid ADR link produces a warning and a commit link. The architecture audit checks all `ARCHITECTURE.md` files at the workflow commit and reports missing `ARCHITECTURE.md`, validation errors, and validator warnings. Both audits stay successful.
- PlantUML remains optional in the hook and Actions. If it is unavailable, document checks continue and report that diagram syntax was not checked.
- Checks use committed documents and source files. Local file and index changes do not affect the result. An ADR added or updated later can remove warnings in the next audit. Previous run summaries do not change. Source checks do not confirm that architecture prose is current; review facts separately.
- Merge commits are supported. Rebase, amend, and squash can change implementation SHAs. Check and update ADR links after these operations.
