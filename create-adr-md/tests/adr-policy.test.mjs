import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../', import.meta.url));
const adrPath = 'docs/adr/0001-cache.md';
const template = readFileSync(join(source, 'create-adr-md/templates/adr.md'), 'utf8');
const relatedSymbolsTemplate = '## Related Symbols\n\n' +
  '| Symbol | File | Type | Lines |\n|---|---|---|---|\n' +
  '| `<QualifiedName>` | `<repository-relative-path>` | <type-from-types.md> | ' +
  '[<repository-relative-path>:<line-number>](<relative-source-path>#L<line-number>) |\n\n';

function document(links, recordType = 'Agent-Session') {
  return template
    .replace('<Short decision title>', 'Cache')
    .replace('YYYY-MM-DD', '2026-11-17')
    .replace('<Agent-Session | Retrospective>', recordType)
    .replace('<Agent Session | Git History | Manual | Mixed>', 'Git History')
    .replace('<Problem and constraints, or "Not recorded.">', 'Not recorded.')
    .replace('<One approved technical decision.>', 'Use a shared cache.')
    .replace('<Supported reasons, or "Not recorded.">', 'Not recorded.')
    .replace('<Rejected alternatives and reasons, or "Not recorded.">', 'Not recorded.')
    .replace('<Known effects and risks, or "Not recorded.">', 'Not recorded.')
    .replace('<Verified implementation facts.>', 'Cache stores one value.')
    .replace(relatedSymbolsTemplate, '')
    .replace('- https://github.com/OWNER/REPO/commit/<FULL_COMMIT_SHA>', links
      .map(sha => `- https://github.com/example/adr-policy/commit/${sha}`).join('\n'));
}

function fixture(t, { objectFormat = 'sha1', codePaths = [] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'adr-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'target repository');
  const snapshots = join(directory, 'snapshots');
  mkdirSync(repo);
  mkdirSync(snapshots);
  for (const folder of ['create-adr-md', 'create-update-architecture-md', '.github', '.githooks']) {
    cpSync(join(source, folder), join(repo, folder), { recursive: true });
  }
  const config = join(repo, '.github/scripts/adr-policy.mjs');
  writeFileSync(config, readFileSync(config, 'utf8')
    .replace(/const CODE_PATHS = .*;/, `const CODE_PATHS = ${JSON.stringify(codePaths)};`));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(?:GIT_|GITHUB_|ADR_|ARCH_)/.test(key)));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'ADR Policy Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'ADR Policy Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    TMPDIR: snapshots,
    ARCH_ALLOW_MISSING: '1',
  });
  const git = (...args) => execFileSync('git', args, {
    cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const run = (command, args, { env: overrides, ...options } = {}) => spawnSync(command, args, {
    cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', ...options,
  });
  const write = (path, content) => {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'Policy fixture change');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '--initial-branch=main', `--object-format=${objectFormat}`);
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '.githooks');
  git('remote', 'add', 'origin', 'https://github.com/example/adr-policy.git');
  const base = commit();
  let value = 0;
  const code = (path = 'src/cache.mjs') => {
    write(path, `export const value = ${++value};\n`);
    return commit();
  };
  const hook = (before = base, allowMissing = '') => {
    const result = run(join(repo, '.githooks/pre-push'), ['origin'], {
      input: `refs/heads/main ${git('rev-parse', 'HEAD')} refs/heads/main ${before}\n`,
      detached: true, env: { ADR_ALLOW_MISSING: allowMissing },
    });
    assert.deepEqual(readdirSync(snapshots), [], 'Hook removes its snapshots');
    return result;
  };
  const audit = () => {
    const summaryPath = join(directory, 'summary.md');
    writeFileSync(summaryPath, '');
    const result = run(process.execPath, ['.github/scripts/audit-adr.mjs'], {
      env: { GITHUB_REPOSITORY: 'example/adr-policy', GITHUB_STEP_SUMMARY: summaryPath },
    });
    assert.deepEqual(readdirSync(snapshots), [], 'Audit removes its snapshots');
    return { ...result, summary: readFileSync(summaryPath, 'utf8') };
  };
  return { directory, repo, base, git, run, write, commit, code, hook, audit };
}

function status(result, expected) {
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
}

function auditWarnings(result, missing = 0) {
  status(result, 0);
  const warnings = result.stdout.split('\n').filter(line => line.startsWith('::warning'));
  assert.equal(warnings.length, missing, result.stdout);
  for (const warning of warnings) assert.match(warning, /^::warning title=ADR missing::/);
  assert.doesNotMatch(result.summary, /Invalid ADR/i);
  if (missing > 0) assert.ok(result.summary.includes(`Missing ADR **${missing}**`), result.summary);
}

test('importing the validator is silent and preserves the exit code', t => {
  const repo = fixture(t);
  for (const exitCode of [0, 7]) {
    const result = repo.run(process.execPath, ['--input-type=module', '--eval',
      `process.exitCode = ${exitCode}; await import('./create-adr-md/scripts/validate-adr.mjs');`]);
    status(result, exitCode);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('the validator CLI preserves success, validation, and usage exit codes', t => {
  const repo = fixture(t);
  const implementation = repo.code();
  const args = ['create-adr-md/scripts/validate-adr.mjs', adrPath, '--repo', '.', '--remote', 'origin'];
  repo.write(adrPath, document([implementation]));
  status(repo.run(process.execPath, args), 0);
  repo.write(adrPath, '# Invalid ADR\n');
  status(repo.run(process.execPath, args), 1);
  status(repo.run(process.execPath, [args[0]]), 2);
  status(repo.run(process.execPath, [args[0], '--help']), 0);
});

test('hook and audit report uncovered code commits and skip merges', t => {
  const repo = fixture(t, { codePaths: ['main.swift', 'Sources/', 'src/'] });
  const rootFile = repo.code('main.swift');
  repo.git('checkout', '-qb', 'side');
  const side = repo.code('Sources/cache.mjs');
  repo.git('checkout', '-q', 'main');
  const main = repo.code();
  repo.git('merge', '-q', '--no-ff', '-s', 'ours', '-m', 'Merge side history', 'side');
  const merge = repo.git('rev-parse', 'HEAD');
  const hook = repo.hook();
  status(hook, 1);
  const audit = repo.audit();
  auditWarnings(audit, 3);
  assert.match(audit.summary, /Scanned \*\*4\*\* recent non-merge commits/);
  for (const sha of [rootFile, side, main]) {
    assert.ok(hook.stderr.includes(sha), hook.stderr);
    assert.ok(audit.summary.includes(sha), audit.summary);
  }
  assert.ok(!hook.stderr.includes(merge), hook.stderr);
  assert.ok(!audit.summary.includes(merge), audit.summary);
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`${objectFormat} new and updated ADRs retain links across pushes`, t => {
    const repo = fixture(t, { objectFormat, codePaths: ['src/'] });
    const first = repo.code();
    repo.write(adrPath, document([first]));
    const before = repo.commit();
    status(repo.hook(), 0);
    const later = repo.code();
    repo.write(adrPath, document([first, later]));
    repo.commit();
    status(repo.hook(before), 0);
    const audit = repo.audit();
    auditWarnings(audit);
    assert.ok(!audit.summary.includes(first), audit.summary);
    assert.ok(!audit.summary.includes(later), audit.summary);
  });
}

test('invalid added or modified ADR blocks push, but a final correction passes', t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  const implementation = repo.code();
  const valid = document([implementation]);
  repo.write(adrPath, valid.replace('**Status:** Accepted\n', ''));
  repo.commit();
  status(repo.hook(), 1);
  auditWarnings(repo.audit(), 1);
  repo.write(adrPath, valid);
  const before = repo.commit();
  status(repo.hook(), 0);
  repo.write(adrPath, valid.replace('Use a shared cache.', 'Not recorded.'));
  repo.commit();
  status(repo.hook(before), 1);
});

test('unchanged invalid ADRs and ADR deletion do not block code', t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  repo.write(adrPath, '# Old document\n');
  const before = repo.commit();
  repo.code();
  status(repo.hook(before, '1'), 0);
  auditWarnings(repo.audit(), 1);
  rmSync(join(repo.repo, adrPath));
  repo.code('main.swift');
  status(repo.hook(before, '1'), 0);
  auditWarnings(repo.audit(), 1);
});

test('first publication validates all ADRs in the final tree', t => {
  const repo = fixture(t);
  const implementation = repo.code();
  repo.write(adrPath, '# Invalid ADR\n');
  repo.commit();
  repo.write('notes.txt', 'Unrelated change.\n');
  repo.commit();
  const zero = '0'.repeat(repo.base.length);
  status(repo.hook(zero), 1);
  repo.write(adrPath, document([implementation], 'Retrospective'));
  repo.commit();
  status(repo.hook(zero), 0);
});

test('links must precede the last ADR change even after merging their branch', t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  const implementation = repo.code();
  repo.git('checkout', '-qb', 'side');
  const side = repo.code();
  repo.git('checkout', '-q', 'main');
  repo.write(adrPath, document([implementation, side]));
  repo.commit();
  status(repo.hook(), 1);
  repo.git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
  status(repo.hook(), 1);
  auditWarnings(repo.audit(), 2);
});

for (const reason of ['unknown commit', 'remote mismatch']) {
  test(`changed ADR rejects ${reason}`, t => {
    const repo = fixture(t, { codePaths: ['src/'] });
    const implementation = repo.code();
    const text = reason === 'unknown commit'
      ? document(['f'.repeat(implementation.length)])
      : document([implementation]).replace('example/adr-policy/commit/', 'other/project/commit/');
    repo.write(adrPath, text);
    repo.commit();
    status(repo.hook(), 1);
    auditWarnings(repo.audit(), 1);
  });
}

test('only uncovered commits in configured paths produce warnings', t => {
  const repo = fixture(t, { codePaths: ['main.swift', 'Sources/'] });
  const linked = repo.code('main.swift');
  const review = repo.code('Sources/cache.mjs');
  const excluded = repo.code('other/main.mjs');
  repo.write(adrPath, document([linked]));
  repo.commit();
  const hook = repo.hook();
  status(hook, 1);
  assert.deepEqual(hook.stderr.split('\n').filter(line => line.startsWith('WARNING:')),
    [`WARNING: No valid ADR links to code commit ${review}`]);
  const audit = repo.audit();
  auditWarnings(audit, 1);
  const warning = audit.stdout.split('\n').find(line => line.startsWith('::warning title=ADR missing::'));
  const url = `https://github.com/example/adr-policy/commit/${review}`;
  assert.ok(warning.includes(review), warning);
  assert.ok(warning.includes(url), warning);
  assert.ok(audit.summary.includes(`](${url})`), audit.summary);
  assert.ok(!audit.summary.includes(linked), audit.summary);
  assert.ok(!audit.summary.includes(excluded), audit.summary);
});

test('bundled code paths include scripts, hooks, and tests', t => {
  const repo = fixture(t);
  const config = '.github/scripts/adr-policy.mjs';
  repo.write(config, readFileSync(join(source, config), 'utf8'));
  const commits = [
    '.github/scripts/probe.mjs', '.githooks/probe',
    'create-adr-md/scripts/probe.mjs', 'create-adr-md/tests/probe.test.mjs',
    'create-update-architecture-md/scripts/probe.mjs', 'create-update-architecture-md/tests/probe.test.mjs',
  ].map(path => repo.code(path));
  repo.write('docs/notes.md', 'Documentation only.\n');
  const documentation = repo.commit();
  const audit = repo.audit();
  auditWarnings(audit, 7);
  const hook = repo.hook('0'.repeat(repo.base.length));
  status(hook, 1);
  for (const sha of [repo.base, ...commits]) assert.ok(audit.summary.includes(sha), sha);
  for (const sha of [repo.base, ...commits]) assert.ok(hook.stderr.includes(sha), sha);
  assert.ok(!audit.summary.includes(documentation), audit.summary);
});

test('audit scans the last 30 non-merge commits and the first push scans all commits', t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  const commits = Array.from({ length: 31 }, () => repo.code());
  const audit = repo.audit();
  auditWarnings(audit, 30);
  assert.match(audit.summary, /Scanned \*\*30\*\* recent non-merge commits/);
  assert.ok(!audit.summary.includes(commits[0]), audit.summary);
  for (const sha of commits.slice(1)) assert.ok(audit.summary.includes(sha), sha);
  const hook = repo.hook('0'.repeat(repo.base.length));
  status(hook, 1);
  for (const sha of commits) assert.ok(hook.stderr.includes(sha), sha);
});

for (const codePaths of [[], null, 'src/', [''], ['/tmp/code'], ['../src/']]) {
  test(`disabled or invalid CODE_PATHS ${JSON.stringify(codePaths)} does not disable ADR validation`, t => {
    const repo = fixture(t, { codePaths });
    const implementation = repo.code();
    repo.write(adrPath, '# Invalid ADR\n');
    repo.commit();
    status(repo.hook(), 1);
    const audit = repo.audit();
    auditWarnings(audit);
    assert.match(audit.summary, /Review hints skipped: CODE_PATHS/);
    repo.write(adrPath, document([implementation]));
    repo.commit();
    status(repo.hook(), 0);
    auditWarnings(repo.audit());
  });
}

test('hook and audit use the committed ADR rather than working tree edits', t => {
  const repo = fixture(t);
  const implementation = repo.code();
  repo.write(adrPath, '# Invalid ADR\n');
  repo.commit();
  repo.write(adrPath, document([implementation]));
  status(repo.hook(), 1);
  repo.commit();
  repo.write(adrPath, '# Uncommitted invalid ADR\n');
  status(repo.hook(), 0);
  auditWarnings(repo.audit());
});

test('real pushes use the advertised remote tip and the pushed tree', t => {
  const repo = fixture(t, { codePaths: ['main.swift'] });
  const remote = join(repo.directory, 'remote.git');
  repo.git('init', '-q', '--bare', remote);
  repo.git('remote', 'set-url', '--push', 'origin', remote);
  const push = (ref = 'main', allowMissing = '') => repo.run('git', ['push', '-q', 'origin', ref], {
    input: 'yes\n', detached: true, env: { ADR_ALLOW_MISSING: allowMissing },
  });
  const remoteTip = () => repo.git('--git-dir', remote, 'rev-parse', 'refs/heads/main');
  const implementation = repo.code('main.swift');
  const denied = push();
  status(denied, 1);
  assert.ok(denied.stderr.includes(implementation), denied.stderr);
  assert.match(denied.stderr, /ADR_ALLOW_MISSING=1 git push/);
  status(push('main', '1'), 0);
  assert.equal(remoteTip(), implementation);

  repo.git('update-ref', 'refs/remotes/origin/main', repo.base);
  const later = repo.code('main.swift');
  repo.git('checkout', '-qb', 'with-adr');
  repo.write(adrPath, document([later]));
  const documented = repo.commit();
  const older = push('main', '0');
  status(older, 1);
  assert.deepEqual(older.stderr.split('\n').filter(line => line.startsWith('WARNING:')),
    [`WARNING: No valid ADR links to code commit ${later}`]);
  assert.equal(remoteTip(), implementation);

  repo.git('checkout', '-q', 'main');
  repo.write(adrPath, '# Uncommitted invalid ADR\n');
  const accepted = push('with-adr:main');
  status(accepted, 0);
  assert.doesNotMatch(accepted.stderr, /WARNING:/);
  assert.equal(remoteTip(), documented);

  rmSync(join(repo.repo, adrPath));
  repo.git('merge', '-q', '--ff-only', 'with-adr');
  repo.code('main.swift');
  repo.write(adrPath, '# Invalid changed ADR\n');
  repo.commit();
  const invalid = push('main', '1');
  status(invalid, 1);
  assert.match(invalid.stderr, /ADR CHECK FAILED: docs\/adr\/0001-cache\.md/);
  assert.equal(remoteTip(), documented);
});
