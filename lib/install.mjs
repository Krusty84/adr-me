import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHook, renderWorkflow } from "./render.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
export const SKILLS = ["create-adr-md", "create-update-architecture-md"];
export const AGENTS = {
  codex: { label: "Codex", project: ".agents/skills", global: ".codex/skills" },
  opencode: { label: "OpenCode", project: ".opencode/skills", global: ".config/opencode/skills" },
  claude: { label: "Claude Code", project: ".claude/skills", global: ".claude/skills" },
};

export function git(repository, ...args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr.trim() || "Git command failed.");
  return result.stdout.trim();
}

export function findRepository(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  return result.status === 0 ? realpathSync(result.stdout.trim()) : null;
}

function inside(directory, path) {
  const child = relative(directory, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function normalizeCodePath(value, repository) {
  const input = value?.trim();
  if (!input) throw new Error("Enter a file or directory path.");
  if (isAbsolute(input) || input.split("/").includes("..") || /[*?\[\]{}\\\x00-\x1f]/.test(input) || /[!+@]\(/.test(input))
    throw new Error("Use a repository-relative path without '..' or glob patterns.");
  const target = resolve(repository, input);
  if (!inside(repository, target)) throw new Error("The path must stay inside the repository.");
  let info;
  try {
    if (!inside(repository, realpathSync(target))) throw new Error("outside");
    info = statSync(target);
  } catch {
    throw new Error("Use an existing file or directory inside the repository.");
  }
  if (!info.isFile() && !info.isDirectory()) throw new Error("Use a regular file or directory.");
  const path = relative(repository, target).split(sep).join("/") || ".";
  return info.isDirectory() && path !== "." ? `${path}/` : path;
}

function skillFiles(skill, directory = "") {
  return readdirSync(join(source, skill, directory), { withFileTypes: true })
    .filter(({ name }) => name !== "tests")
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return skillFiles(skill, path);
      if (!entry.isFile()) throw new Error(`The packaged skill contains a non-regular file: ${skill}/${path}`);
      const original = join(source, skill, path);
      return [{ path, data: readFileSync(original), mode: statSync(original).mode & 0o111 ? 0o755 : 0o644 }];
    });
}

function existing(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function fileState(file) {
  for (let parent = dirname(file.path); ; parent = dirname(parent)) {
    const info = existing(parent);
    if (info && !info.isDirectory()) return "conflict";
    if (parent === dirname(parent)) break;
  }
  const info = existing(file.path);
  if (!info) return "new";
  if (!info.isFile() || (file.mode & 0o100 && !(info.mode & 0o100))) return "conflict";
  return file.data.equals(readFileSync(file.path)) ? "identical" : "conflict";
}

export function install(choices, { repository, userDirectory = homedir() }) {
  if (!repository && (choices.scope === "project" || choices.hook || choices.actions))
    throw new Error("Project skills, hooks, and Actions require a Git working tree.");
  const components = [];
  const resources = new Map(choices.skills.map((skill) => [skill, skillFiles(skill)]));
  const add = (name, kind, files, extra = {}) => {
    const component = { name, kind, files, written: [], identical: [], conflicts: [], pending: [], ...extra };
    components.push(component);
    return component;
  };
  for (const agent of choices.agents) {
    const base = join(choices.scope === "project" ? repository : realpathSync(userDirectory), AGENTS[agent][choices.scope]);
    for (const skill of choices.skills) add(`${AGENTS[agent].label}: ${skill}`, "skill",
      resources.get(skill).map((file) => ({ ...file, path: join(base, skill, file.path) })),
      { destination: join(base, skill) });
  }

  if (choices.hook || choices.actions) {
    const files = [];
    for (const skill of choices.skills) {
      for (const file of resources.get(skill).filter(({ path }) => path !== "SKILL.md"))
        files.push({ ...file, path: join(repository, ".adr-me", skill, file.path) });
    }
    const checkFile = (script) => {
      let data = readFileSync(join(source, ".github/scripts", script));
      if (script === "adr-policy.mjs") data = Buffer.from(data.toString().replace(
        /^const CODE_PATHS = .*;$/m, () => `const CODE_PATHS = ${JSON.stringify(choices.codePaths)};`,
      ));
      return { path: join(repository, ".adr-me/.github/scripts", script), data, mode: 0o644 };
    };
    const adr = choices.skills.includes(SKILLS[0]);
    if (adr) files.push(checkFile("adr-policy.mjs"));
    if (choices.skills.includes(SKILLS[1])) files.push(checkFile("check-architecture.mjs"));
    const checks = add("Shared check resources", "checks", files);
    if (choices.hook) {
      const dependencies = [checks];
      if (adr) dependencies.push(add("ADR push check script", "checks", [checkFile("check-adr.mjs")]));
      const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: repository, encoding: "utf8" });
      if (configured.status === 0) add("Local pre-push hook", "hook", [], {
        reason: `core.hooksPath is already set to ${JSON.stringify(configured.stdout.trim())}. Existing settings are kept.`,
      });
      else add("Local pre-push hook", "hook", [{
        path: resolve(repository, git(repository, "rev-parse", "--git-path", "hooks/pre-push")),
        data: Buffer.from(renderHook(choices.skills)), mode: 0o755,
      }], { dependencies });
    }
    if (choices.actions) {
      const dependencies = [checks];
      if (adr) dependencies.push(add("ADR audit script", "checks", [checkFile("audit-adr.mjs")]));
      add("GitHub Actions workflow", "workflow", [{
        path: join(repository, ".github/workflows/adr-check.yml"),
        data: Buffer.from(renderWorkflow(choices.skills)), mode: 0o644,
      }], { dependencies });
    }
  }

  // Inspect every component before writing any files. A conflict skips the whole component.
  for (const component of components) {
    try {
      if (!component.reason) for (const file of component.files) {
        const state = fileState(file);
        if (state === "conflict") component.conflicts.push(file.path);
        else if (state === "identical") component.identical.push(file.path);
        else component.pending.push(file);
      }
      if (component.conflicts.length) component.reason = "Existing files differ, are not regular files, or lack execute permission.";
    } catch (error) {
      component.error = error.message;
      component.reason = error.message;
    }
    component.status = component.reason ? "skipped" : "ready";
  }

  for (const component of components) {
    if (component.status === "skipped") continue;
    if (component.dependencies?.some(({ status }) => !["installed", "unchanged"].includes(status))) {
      component.status = "skipped";
      component.reason = "Required check scripts could not be installed. The existing hook or workflow is kept.";
      continue;
    }
    try {
      for (const file of component.pending) {
        mkdirSync(dirname(file.path), { recursive: true });
        writeFileSync(file.path, file.data, { flag: "wx", mode: file.mode });
        component.written.push(file.path);
        if (file.mode & 0o100) chmodSync(file.path, file.mode);
      }
      component.status = component.written.length ? "installed" : "unchanged";
    } catch (error) {
      component.status = "failed";
      component.error = error.message;
      component.reason = error.message;
    }
  }
  return components;
}

export function commitSummary(components, repository) {
  const paths = [...new Set(components.filter(({ kind }) => kind !== "hook")
    .flatMap(({ written, identical, status }) => [...written, ...(["installed", "unchanged"].includes(status) ? identical : [])])
    .filter((path) => inside(repository, path)).map((path) => relative(repository, path)))];
  if (!paths.length) return { status: "", ignored: "" };
  const ignored = spawnSync("git", ["check-ignore", "--", ...paths], { cwd: repository, encoding: "utf8" });
  return {
    status: git(repository, "--no-optional-locks", "status", "--short", "--untracked-files=all", "--", ...paths),
    ignored: ignored.stdout?.trim() || "",
  };
}
