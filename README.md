# adr-me

Use an AI agent to document architecture decisions, system architecture, and codebase rules.

## What Is This?

adr-me includes three skills with templates and validators.

- [create-adr-md](create-adr-md/SKILL.md) records accepted technical decisions in Architecture Decision Records (ADRs).
- [create-update-architecture-md](create-update-architecture-md/SKILL.md) describes the current system in `ARCHITECTURE.md`.
- [extract-codebase-rules](extract-codebase-rules/SKILL.md) documents technical constraints in `CONSTRAINTS.md` and recurring practices in `CONVENTIONS.md`.

<img width="363" height="309" alt="image" src="https://github.com/user-attachments/assets/b58f5734-b2d6-4932-93ac-54e16937ee06" />

<img width="925" height="924" alt="image" src="https://github.com/user-attachments/assets/4184da80-c52f-4d7a-b3fe-7fa85301910c" />

<img width="1330" height="932" alt="image" src="https://github.com/user-attachments/assets/5b7dcf26-79c9-4b13-972d-b3b276e267d3" />

## Features

- Record technical decisions in `ADR.md` from an agent session or Git history.
- Link `ADR.md` to implementation commits and source symbols.
- Create `ARCHITECTURE.md` from an agent session or Git history.
- Create and update `ARCHITECTURE.md` with source links and PlantUML context and component diagrams.
- Analyzing the code base to identify constraints, conventions/rules, and create the `CONSTRAINTS.md` and `CONVENTIONS.md` documents.
- Check `ADR.md` and `ARCHITECTURE.md` documents structure, source references, and `ADR.md` commit links.
- Check `ADR.md` and `ARCHITECTURE.md` documents before pushes to `main`. 
- Report `ADR.md` and `ARCHITECTURE.md` validation issues and code commits without valid `ADR.md` links as warnings in GitHub Actions.

## Who is it for?

Developers and engineers who use agents in their work, but don't want to lose control over the decisions made and what is happening with their system overall.

## How to install

The installer requires Node.js 22 or later on macOS or Linux. 
Git is required for project installation, hooks, and GitHub Actions. 
The installed validators need no npm packages.

For a published npm release, run the wizard from the target repository or any of its subdirectories:

```sh
npx adr-me
```

Or install directly from GitHub:

```sh
npx --package=github:Krusty84/adr-me adr-me
```

You can also download a package archive from [GitHub Releases](https://github.com/Krusty84/adr-me/releases).

Select one or more agents, the installation scope, and `All` or one skill. Project installation and both skills are the defaults. Skill directories contain the instructions, scripts, templates, and references, tests are excluded.

| Agent | Project | Global |
| --- | --- | --- |
| Codex | `.agents/skills/` | `~/.codex/skills/` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |

Project installation uses the Git repository root. Outside a Git working tree, only global skills are available. The wizard requires an interactive terminal. Cancellation during questions writes no files.

Existing files are kept. Identical files are skipped. A conflicting file skips the whole skill for that agent. Other components can still install. Repeating the same choices adds only missing files, changing existing generated files requires manual conflict resolution. The summary lists installed and skipped components, conflicts, and files to commit. The installer does not stage, commit, or push.

`ADR.md` validation requires a configured Git remote and the implementation commits in local history.

### Install PlantUML (optional)

PlantUML is optional. Make `plantuml` available on `PATH` to check diagram syntax. Without it, the architecture validator checks the document and reports that diagram syntax was not checked.

**macOS:** With [Homebrew](https://formulae.brew.sh/formula/plantuml) installed, run:

```sh
brew install plantuml
plantuml -version
```

**Linux (Debian/Ubuntu):** Install [PlantUML](https://packages.debian.org/stable/plantuml) and Graphviz:

```sh
sudo apt update
sudo apt install plantuml graphviz
plantuml -version
```

These packages include the required Java dependencies. For other distributions or newer versions, follow the [official installation guide](https://plantuml.com/starting). Prefer PlantUML 1.2026.4 or newer, older versions produce a validator warning.

**Windows:** With [Chocolatey](https://community.chocolatey.org/packages/plantuml) installed, open PowerShell as Administrator and run:

```powershell
choco install plantuml -y
```

Open a new PowerShell window and check the console command:

```powershell
plantumlc -version
```

Chocolatey uses `plantumlc` for console operations. To run adr-me on Windows, use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) and follow the Linux steps inside WSL.

### Optional push checks

Git pre-push and GitHub Actions checks are optional and off by default. Enable them independently in the wizard. Their shared scripts and resources use `.github/scripts/adr-me/`. Commit this directory and the selected workflow. See [setup instructions](WORKFLOW.md#optional-push-checks).

## How to use

Tell the agent to read the required skill's `SKILL.md`. Example requests:

```text
Use create-adr-md to record the accepted decision from this session.
Use create-update-architecture-md to describe the current system in docs/ARCHITECTURE.md
Use extract-codebase-rules to inspect the whole repository and summarize its constraints and conventions in docs/CONSTRAINTS.md and docs/CONVENTIONS.md.
```

`ADR.md` use `docs/adr/NNNN-short-title.md`. New architecture documents use `docs/ARCHITECTURE.md` existing documents keep their current path.

Validate documents after each change. Review facts and ASD-STE100 style separately. 

See [ADR and ARCHITECTURE workflows and push checks](WORKFLOW.md) for validation commands.
