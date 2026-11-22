# ADR and ARCHITECTURE workflows and checks

- [ADR and ARCHITECTURE workflows and checks](#adr-and-architecture-workflows-and-checks)
  - [ADR workflow](#adr-workflow)
  - [ARCHITECTURE workflow](#architecture-workflow)
  - [Optional push checks](#optional-push-checks)
  - [Push checks and audit](#push-checks-and-audit)

## ADR workflow

Use one `ADR.md` per technical decision. The user can defer a record. For the same decision, update the existing `ADR.md`: keep its ID, creation date, and valid links, then add the new facts and commit links.

Approve the decision, text, and intended Git commits first. Commit the implementation before the `ADR.md`. For a decision from Git history, use the existing implementation commits. A push requires separate approval.

After the implementation commit, get its full SHA:

```sh
git rev-parse HEAD
```

Use the [ADR template](create-adr-md/templates/adr.md) to create `docs/adr/0042-cache-sync.md`. This example shows the required fields. Replace the facts, date, repository URL, and SHA with verified values.

Use one HTTPS URL bullet per implementation commit, with a full 40- or 64-character SHA. Each linked commit must precede the commit that last changed the `ADR.md`. Keep ADRs as regular files at `docs/adr/NNNN-lowercase-slug.md`.

The optional `Related Symbols` table links declarations to source files and lines. Select types from the [type catalog](create-adr-md/references/types.md). Review the 120-character title limit and the 350-word limit for the title and six prose sections manually.

Validate the `ADR.md`, then commit it separately from the implementation:

```sh
node .agents/skills/create-adr-md/scripts/validate-adr.mjs docs/adr/0042-cache-sync.md --repo . --remote origin
git add docs/adr/0042-cache-sync.md
git commit -m 'docs: record cache synchronization `ADR.md`'
```

After separate push approval:

```sh
git push origin main
```

## ARCHITECTURE workflow

Use `create-update-architecture-md` to create or update an architecture document - `ARCHITECTURE.md`.

1. Inspect the current code, configuration, existing documentation, and relevant ADRs. Identify the system boundary, components, entry points, and data flow.
2. For a new `ARCHITECTURE.md`, use the [architecture template](create-update-architecture-md/templates/arch.md) and write `docs/ARCHITECTURE.md`. Keep an existing `ARCHITECTURE.md` at its current path. If several documents match the request, ask which one to update.
3. Keep the template attributes and sections in order. Set `Date` to the `ARCHITECTURE.md` creation or update date. Use confirmed facts. Ask for missing facts in `Overview`, `System context`, and `System components`.  
In other sections, use `Not recorded.` or `Not applicable.` with a short reason where needed.
4. Add verified source links with repository paths and line numbers. Keep link targets relative to the `ARCHITECTURE.md`. Include a PlantUML context diagram in `System context` and a component diagram in `System components`.  
Use built-in syntax without external includes or imports. For updates, correct obsolete claims, links, and diagrams.

Run the bundled validator from the repository root. This example uses the Codex project installation. For another installation, use that skill's directory. For an existing `ARCHITECTURE.md`, use its current path.

```sh
node .agents/skills/create-update-architecture-md/scripts/validate-arch.mjs docs/ARCHITECTURE.md --repo .
```

Correct all validation errors and run validation again. Review factual accuracy and ASD-STE100 style separately.  
PlantUML is optional: if it is unavailable, `ARCHITECTURE.md` checks continue with a warning that diagram syntax was not checked. Report this warning.

See [PlantUML installation](README.md#install-plantuml-optional) for setup.

## Optional push checks

The wizard offers the local Git pre-push hook and GitHub Actions independently. Both are off by default. They apply to the current repository even when skills are installed globally, and run checks only for the selected skills.

For `ADR.md` checks, enter at least one existing code file or directory relative to the repository root, such as `src/`. Enter paths individually. Absolute paths, `..`, glob patterns, and paths outside the repository are rejected.

Check scripts are copied directly into `.github/scripts/adr-me/`. Validators, templates, and references use its `create-adr-md/` and `create-update-architecture-md/` subdirectories. These resources exclude `SKILL.md` and tests. They work without globally installed skills or the npm cache. The selected code paths are written to `.github/scripts/adr-me/adr-policy.mjs`; the hook and Actions share this configuration.

The hook is installed at the path reported by `git rev-parse --git-path hooks/pre-push` and made executable. An existing different hook or a configured `core.hooksPath` skips hook installation. Existing settings are kept. Hooks are local: run the wizard on each developer computer to connect the committed checks, using the same skills and code paths.

GitHub Actions is written to `.github/workflows/adr-check.yml`. Commit this workflow and `.github/scripts/adr-me/` so Actions can read the checks. The installer lists these files under `Files to commit`; the local hook is excluded. A conflicting check dependency prevents installation of its hook or workflow.

The hook uses the push remote. GitHub Actions uses `origin` through `ADR_REMOTE` in the installed workflow. Keep `fetch-depth: 0` so the audit has full Git history.

## Push checks and audit

- The local hook checks direct pushes to `main`. It validates new and changed ADRs in the final pushed tree. Invalid ADRs stop the push.
- On each update to `main`, the hook also validates every tracked file with the exact name `ARCHITECTURE.md`, at any repository path. This includes unchanged documents and their source links. Invalid documents stop the push before any confirmation prompt.
- The hook checks new non-merge code commits in `CODE_PATHS` from the remote tip to the pushed SHA. The first push checks the full pushed history and all ADRs.
- For commits without valid `ADR.md` links, the hook asks for confirmation once. Enter `y` or `yes` to continue. Any other reply, no reply, or end of input stops the push.
- Without a terminal, use `ADR_ALLOW_MISSING=1 git push origin main` to accept missing `ADR.md` links. Invalid new or changed ADRs still stop the push. `git push --no-verify` skips the hook.
- If no `ARCHITECTURE.md` exists, the hook asks for separate confirmation. Enter `y` or `yes` to continue, any other reply stops the push. Without a terminal, use `ARCH_ALLOW_MISSING=1 git push origin main`. This flag does not allow invalid `ARCHITECTURE.md`. Set both flags if both records are missing.
- GitHub Actions runs after pushes to `main` and on demand. It scans the last 30 non-merge commits for changes in `CODE_PATHS`, including earlier pushes. Set `ADR_SCAN_LIMIT` in the workflow to change the limit (1–500).
- Each code commit without a valid `ADR.md` link produces a warning and a commit link. The architecture audit checks all `ARCHITECTURE.md` files at the workflow commit and reports missing `ARCHITECTURE.md`, validation errors, and validator warnings. Both audits stay successful.
- PlantUML remains optional in the hook and Actions. If it is unavailable, `ARCHITECTURE.md` checks continue and report that diagram syntax was not checked.
- Checks use committed documents and source files. Local file and index changes do not affect the result. An `ADR.md` added or updated later can remove warnings in the next audit. Previous run summaries do not change. Source checks do not confirm that architecture prose is current, review facts separately.
- Merge commits are supported. Rebase, amend, and squash can change implementation SHAs. Check and update `ADR.md` links after these operations.
