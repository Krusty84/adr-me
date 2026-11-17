// Shared ADR validation against a committed tree. Requires Node.js 18+.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const CODE_PATHS = ['src/', 'app/', 'lib/', 'test/', 'tests/'];

export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function gitList(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0').filter(Boolean);
}
export function isAncestor(a, b) {
  return spawnSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }).status === 0;
}

export function validateAdrs(revision, paths) {
  const entries = gitList('ls-tree', '-r', '-z', revision, '--', 'docs/adr/').map(entry => {
    const tab = entry.indexOf('\t');
    const [mode, type, object] = entry.slice(0, tab).split(' ');
    return { mode, type, object, path: entry.slice(tab + 1) };
  });
  const files = entries.map(entry => entry.path);
  const selected = paths ?? files.filter(path => path.endsWith('.md'));
  if (selected.length === 0) return [];

  const repo = git('rev-parse', '--show-toplevel');
  const validator = join(repo, 'create-adr-md', 'scripts', 'validate-adr.mjs');
  const gitDir = git('rev-parse', '--absolute-git-dir');
  const snapshot = realpathSync(mkdtempSync(join(tmpdir(), 'adr-validation-')));
  const remote = process.env.ADR_REMOTE || 'origin';
  const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: snapshot };

  try {
    for (const entry of entries) {
      const target = join(snapshot, entry.path);
      if (entry.type === 'commit') {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const content = execFileSync('git', ['cat-file', 'blob', entry.object], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (entry.mode === '120000') symlinkSync(content.toString('utf8'), target);
      else writeFileSync(target, content);
    }

    return selected.map(path => {
      const result = spawnSync(process.execPath, [
        validator, path, '--repo', snapshot, '--remote', remote,
      ], { cwd: snapshot, env, encoding: 'utf8' });
      if (result.status !== 0) {
        const message = result.error?.message || result.stderr?.trim() || result.stdout?.trim()
          || 'ADR validator failed';
        return { path, links: [], errors: [message] };
      }

      const lines = readFileSync(join(snapshot, path), 'utf8').split('\n');
      const heading = lines.findIndex(line => line.startsWith('## ')
        && line.slice(3).trim() === 'Implementation Commit');
      const links = lines.slice(heading + 1).map(line => line.trim()).filter(Boolean).map(line => {
        const url = new URL(line.slice(2).trim());
        return url.pathname.replace(/\/$/, '').split('/').at(-1).toLowerCase();
      });
      return { path, links, errors: [] };
    });
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}
