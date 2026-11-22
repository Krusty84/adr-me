#!/usr/bin/env node

import { AGENTS, SKILLS, commitSummary, findRepository, install, normalizeCodePath } from "../lib/install.mjs";

const usage = "Usage: adr-me init\n\nStart the interactive skill installer. Installation flags are not supported.";
const cancelled = Symbol("cancelled");

async function initialize(p) {
  p.intro("adr-me");
  const ask = async (question) => {
    const answer = await question;
    if (p.isCancel(answer)) throw cancelled;
    return answer;
  };
  try {
    const repository = findRepository();
    const agents = await ask(p.multiselect({
      message: "Select agents.",
      options: Object.entries(AGENTS).map(([value, { label }]) => ({ value, label })),
      required: true,
    }));
    const scope = await ask(p.select({
      message: "Where should skills be installed?",
      options: [
        ...(repository ? [{ value: "project", label: "Project", hint: repository }] : []),
        { value: "global", label: "Global", hint: "Your user account" },
      ],
      initialValue: repository ? "project" : "global",
    }));
    const selected = await ask(p.select({
      message: "Select skills.",
      options: [{ value: "all", label: "All" }, ...SKILLS.map((value) => ({ value, label: value }))],
      initialValue: "all",
    }));
    const skills = selected === "all" ? SKILLS : [selected];
    let hook = false;
    let actions = false;
    if (repository) {
      hook = await ask(p.confirm({ message: "Install a local Git pre-push hook?", initialValue: false }));
      actions = await ask(p.confirm({ message: "Install a GitHub Actions workflow?", initialValue: false }));
    } else p.log.info("No Git working tree. Hooks and GitHub Actions are unavailable.");

    const codePaths = [];
    if ((hook || actions) && skills.includes(SKILLS[0])) {
      p.log.info(`Code paths are relative to ${repository}`);
      do {
        const path = await ask(p.text({
          message: "Enter a code file or directory path.",
          placeholder: "src/",
          validate(value) {
            try { normalizeCodePath(value, repository); }
            catch (error) { return error.message; }
          },
        }));
        const normalized = normalizeCodePath(path, repository);
        if (!codePaths.includes(normalized)) codePaths.push(normalized);
      } while (await ask(p.confirm({ message: "Add another code path?", initialValue: false })));
    }

    const components = install({ agents, scope, skills, hook, actions, codePaths }, { repository });
    p.note(components.map((component) => [
      `${component.status.toUpperCase()}: ${component.name}`,
      component.reason || `${component.written.length} file(s) written; ${component.identical.length} identical file(s) kept.`,
      ...(component.kind === "skill" ? [component.destination] : []),
    ].join("\n")).join("\n\n"), "Installation");
    const conflicts = components.flatMap(({ conflicts }) => conflicts);
    if (conflicts.length) p.note(conflicts.join("\n"), "Conflicts (kept unchanged)");
    const localHook = components.find(({ kind }) => kind === "hook");
    if (localHook) p.note([
      localHook.files[0]?.path,
      localHook.reason || "Local to this Git checkout. Run adr-me init on each developer computer.",
    ].filter(Boolean).join("\n"), "Local pre-push hook (not committed)");
    if (repository) {
      const summary = commitSummary(components, repository);
      p.note(summary.status || "None.", "Files to commit (not staged by adr-me)");
      if (summary.ignored) p.note(summary.ignored, "Git ignores these installed files; review before committing");
    }
    const failed = components.some(({ conflicts, error }) => conflicts.length || error);
    p.outro(failed ? "Finished with conflicts or errors. Review the summary." : "Installation complete.");
    if (failed) process.exitCode = 1;
  } catch (error) {
    if (error !== cancelled) throw error;
    p.cancel("Installation cancelled. No files were written.");
    process.exitCode = 130;
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && ["--help", "-h"].includes(args[0]))) console.log(usage);
  else if (args.length !== 1 || args[0] !== "init") throw new Error(usage);
  else {
    if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("adr-me requires Node.js 22 or later.");
    if (!["darwin", "linux"].includes(process.platform)) throw new Error("adr-me supports macOS and Linux.");
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("adr-me init requires an interactive terminal. No files were written.");
    await initialize(await import("@clack/prompts"));
  }
} catch (error) {
  console.error(`adr-me: ${error.message}`);
  process.exitCode = 1;
}
