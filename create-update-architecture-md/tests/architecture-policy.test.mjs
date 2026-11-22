import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { install, SKILLS } from '../../lib/install.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const source = fileURLToPath(new URL('../../', import.meta.url));
const checksPath = '.github/scripts/adr-me';
const template = readFileSync(join(source, 'create-update-architecture-md/templates/arch.md'), 'utf8');
const archPath = 'docs/ARCHITECTURE.md';
const sourcePath = 'src/cache.mjs';

function document(path = archPath) {
  const link = `[${sourcePath}:2](${relative(dirname(path), sourcePath)}#L2)`;
  const diagram = '```plantuml\n@startuml\ncomponent API\ncomponent Cache\nAPI --> Cache\n@enduml\n```';
  const contents = [
    'Cache', 'Agent-Session', 'Agent Session',
    `The service stores values. ${link}`, 'The operator calls the service.', diagram,
    'The service returns values.', `The source directory contains the service. ${link}`,
    `The API owns the cache. ${link}`, diagram, 'The API reads the cache.',
    'The module creates the cache when it loads.', 'The cache stores values in memory.',
    'Not recorded. No design reason is documented.',
    'Not applicable. The module has no external dependencies.',
    'Not recorded. No capacity limit is documented.',
  ];
  let index = 0;
  return template.replace('YYYY-MM-DD', '2026-11-22').replace(/<[^<>\n]+>/g, () => contents[index++]);
}

function fixture(t, { objectFormat = 'sha1', codePaths = [] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'architecture-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'target repository');
  const snapshots = join(directory, 'snapshots');
  const bin = join(directory, 'bin');
  for (const folder of [repo, snapshots, bin]) mkdirSync(folder);
  const gitExecutable = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  symlinkSync(gitExecutable, join(bin, 'git'));
  symlinkSync(process.execPath, join(bin, 'node'));
  writeFileSync(join(bin, 'plantuml'), `#!/usr/bin/env node
if (process.argv.includes('-version')) console.log('PlantUML version 1.2026.4 (test)');
else {
  require('node:fs').readFileSync(0, 'utf8');
  console.log(process.env.PLANTUML_FAIL ? 'ERROR\\nSyntax Error?' : 'COMPONENT\\n(2 entities)');
}
`, { mode: 0o755 });
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(?:GIT_|GITHUB_|ADR_|ARCH_|PLANTUML_)/.test(key)));
  Object.assign(env, {
    PATH: bin, TMPDIR: snapshots,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Architecture Policy Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Architecture Policy Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  });
  const git = (...args) => execFileSync('git', args, {
    cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const run = (command, args, { env: overrides, ...options } = {}) => {
    const result = spawnSync(command, args, {
      cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', ...options,
    });
    assert.deepEqual(readdirSync(snapshots), [], 'Validation removes its snapshots');
    return result;
  };
  const write = (path, content) => {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'Architecture policy fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '--initial-branch=main', `--object-format=${objectFormat}`);
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/example/architecture-policy.git');
  const components = install({ agents: [], scope: 'project', skills: SKILLS, hook: true, actions: true, codePaths },
    { repository: realpathSync(repo) });
  for (const component of components) assert.equal(component.status, 'installed', `${component.name}: ${component.reason}`);
  write(sourcePath, 'export const cache = new Map();\nexport function reset() { cache.clear(); }\n');
  const base = commit();
  const check = (revision = git('rev-parse', 'HEAD'), overrides = {}) => run(process.execPath,
    [`${checksPath}/check-architecture.mjs`], { env: { HEAD_SHA: revision, ...overrides } });
  const hook = ({ before = base, after = git('rev-parse', 'HEAD'), ref = 'refs/heads/main', env } = {}) =>
    run(join(repo, '.git/hooks/pre-push'), ['origin'], {
      input: `refs/heads/main ${after} ${ref} ${before}\n`, detached: true, env,
    });
  const audit = (overrides = {}) => {
    const summaryPath = join(directory, 'summary.md');
    writeFileSync(summaryPath, '');
    const result = run(process.execPath, [`${checksPath}/check-architecture.mjs`, '--audit'], {
      env: { GITHUB_STEP_SUMMARY: summaryPath, ...overrides },
    });
    return { ...result, summary: readFileSync(summaryPath, 'utf8') };
  };
  const terminal = (answer) => {
    const after = git('rev-parse', 'HEAD');
    write('.terminal-test.sh', `#!/bin/sh
printf '%s\\n' 'refs/heads/main ${after} refs/heads/main ${base}' | .git/hooks/pre-push origin
printf 'HOOK_STATUS=%s\\n' "$?"
`);
    const command = process.platform === 'darwin'
      ? '/usr/bin/script -q /dev/null /bin/sh .terminal-test.sh'
      : '/usr/bin/script -q -c "/bin/sh .terminal-test.sh" /dev/null';
    return new Promise((resolve, reject) => {
      // A real pipe avoids BSD script's tcgetattr failure on Node's socket stdin.
      const child = spawn('/bin/sh', ['-c', `/bin/cat | ${command}`], { cwd: repo, env, detached: true });
      const answers = answer === null ? [] : answer.split('\n');
      let sent = 0;
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        process.kill(-child.pid, 'SIGKILL');
      }, 10000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const prompts = stdout.match(/\[y\/N\]/g)?.length ?? 0;
        while (sent < prompts && sent < answers.length) child.stdin.write(`${answers[sent++]}\n`);
        if (stdout.includes('HOOK_STATUS=') || prompts > sent) child.stdin.end();
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        assert.deepEqual(readdirSync(snapshots), [], 'Validation removes its snapshots');
        resolve({ status: code, stdout, stderr });
      });
    });
  };
  return { directory, repo, bin, base, git, run, write, commit, check, hook, audit, terminal };
}

function status(result, expected) {
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`${objectFormat} checks every exact architecture filename at any path`, t => {
    const repo = fixture(t, { objectFormat });
    const paths = ['ARCHITECTURE.md', archPath, 'sub project/docs/ARCHITECTURE.md'];
    for (const path of paths) repo.write(path, document(path));
    repo.write('notes/architecture.md', '# Ignored case mismatch\n');
    repo.write('.gitattributes', 'src/ export-ignore\n');
    repo.commit();
    const result = repo.check();
    status(result, 0);
    for (const path of paths) assert.ok(result.stdout.includes(`ARCHITECTURE OK: ${path}`), result.stdout);
    status(repo.hook(), 0);
    status(repo.hook({ before: '0'.repeat(repo.base.length) }), 0);
    const audit = repo.audit();
    status(audit, 0);
    assert.doesNotMatch(audit.stdout, /::warning/);
    assert.match(audit.summary, /Checked \*\*3\*\*/);
    for (const path of paths) assert.ok(audit.summary.includes(path));
  });
}

test('missing documents require the architecture flag, including staged and deleted documents', t => {
  const repo = fixture(t);
  repo.write(archPath, document());
  status(repo.check(), 2);
  repo.git('add', archPath);
  status(repo.check(), 2);
  const denied = repo.hook();
  status(denied, 1);
  assert.match(denied.stderr, /ARCH_ALLOW_MISSING=1 git push/);
  status(repo.hook({ env: { ADR_ALLOW_MISSING: '1' } }), 1);
  status(repo.hook({ env: { ARCH_ALLOW_MISSING: '1' } }), 0);
  const audit = repo.audit();
  status(audit, 0);
  assert.match(audit.stdout, /::warning title=Architecture missing::/);
  assert.match(audit.summary, /No tracked ARCHITECTURE.md/);
  repo.commit();
  rmSync(join(repo.repo, archPath));
  repo.commit();
  status(repo.check(), 2);
  status(repo.hook(), 1);
});

test('the two missing-record flags remain independent', t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  repo.write(sourcePath, 'export const cache = new Map();\nexport const size = 1;\n');
  repo.commit();
  const architectureOnly = repo.hook({ env: { ARCH_ALLOW_MISSING: '1' } });
  status(architectureOnly, 1);
  assert.match(architectureOnly.stderr, /ADR_ALLOW_MISSING=1 git push/);
  const adrOnly = repo.hook({ env: { ADR_ALLOW_MISSING: '1' } });
  status(adrOnly, 1);
  assert.match(adrOnly.stderr, /ARCH_ALLOW_MISSING=1 git push/);
  status(repo.hook({ env: { ADR_ALLOW_MISSING: '1', ARCH_ALLOW_MISSING: '1' } }), 0);
});

const noTerminalTool = !existsSync('/usr/bin/script') || !['darwin', 'linux'].includes(process.platform);
test('terminal confirmation accepts only y and yes', { skip: noTerminalTool }, async t => {
  const repo = fixture(t);
  repo.write('notes.txt', 'A documentation change.\n');
  repo.commit();
  for (const [answer, expected] of [['y', 0], ['yes', 0], ['n', 1], ['', 1], ['YES', 1], [null, 1]]) {
    const result = await repo.terminal(answer === null ? null : `${answer}\n`);
    status(result, 0);
    assert.match(result.stdout, /Push without ARCHITECTURE.md\?/);
    assert.ok(result.stdout.includes(`HOOK_STATUS=${expected}`), result.stdout);
  }
});

test('terminal confirmation asks separately for ADRs and architecture', { skip: noTerminalTool }, async t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  repo.write(sourcePath, 'export const cache = new Map();\nexport const size = 1;\n');
  repo.commit();
  for (const [answer, expected] of [['yes\nn\n', 1], ['y\nyes\n', 0]]) {
    const result = await repo.terminal(answer);
    status(result, 0);
    assert.match(result.stdout, /Push without ADRs for these commits\?/);
    assert.match(result.stdout, /Push without ARCHITECTURE.md\?/);
    assert.ok(result.stdout.includes(`HOOK_STATUS=${expected}`), result.stdout);
  }
});

test('invalid architecture blocks before missing ADR confirmation and cannot be bypassed', t => {
  const repo = fixture(t, { codePaths: ['src/'] });
  repo.write(sourcePath, 'export const cache = new Map();\nexport const size = 1;\n');
  repo.write('ARCHITECTURE.md', document('ARCHITECTURE.md'));
  repo.write(archPath, '# Invalid architecture\n');
  repo.commit();
  status(repo.check(), 1);
  for (const env of [{}, { ADR_ALLOW_MISSING: '1', ARCH_ALLOW_MISSING: '1' }]) {
    const result = repo.hook({ env });
    status(result, 1);
    assert.match(result.stdout, /ARCHITECTURE FAILED/);
    assert.doesNotMatch(result.stderr, /No terminal|Push without/);
  }
  const audit = repo.audit();
  status(audit, 0);
  assert.match(audit.stdout, /::warning title=Architecture invalid::/);
  assert.match(audit.stdout, /%0A/);
  assert.match(audit.summary, /Checked \*\*2\*\*/);
  assert.match(audit.summary, /Validation passed/);
  assert.match(audit.summary, /Validation failed/);
});

test('invalid ADR blocks before missing architecture confirmation', t => {
  const repo = fixture(t);
  repo.write('docs/adr/0001-cache.md', '# Invalid ADR\n');
  repo.commit();
  const result = repo.hook({ env: { ADR_ALLOW_MISSING: '1', ARCH_ALLOW_MISSING: '1' } });
  status(result, 1);
  assert.match(result.stderr, /ADR CHECK FAILED/);
  assert.doesNotMatch(result.stderr, /No terminal|Push without/);
});

for (const change of ['delete', 'truncate']) {
  test(`unchanged architecture fails after source ${change}`, t => {
    const repo = fixture(t);
    repo.write(archPath, document());
    const before = repo.commit();
    if (change === 'delete') rmSync(join(repo.repo, sourcePath));
    else repo.write(sourcePath, 'export const cache = new Map();\n');
    repo.commit();
    assert.equal(repo.git('diff', '--name-only', before, 'HEAD', '--', archPath), '');
    status(repo.check(), 1);
    status(repo.hook({ before }), 1);
    const audit = repo.audit();
    status(audit, 0);
    assert.match(audit.stdout, /::warning title=Architecture invalid::/);
  });
}

test('working files and staged corrections do not change committed validation', t => {
  const repo = fixture(t);
  repo.write(archPath, '# Invalid architecture\n');
  repo.commit();
  repo.write(archPath, document());
  repo.git('add', archPath);
  status(repo.check(), 1);
  status(repo.hook(), 1);
  assert.match(repo.audit().stdout, /::warning title=Architecture invalid::/);
  repo.commit();
  repo.write(archPath, '# Uncommitted invalid architecture\n');
  rmSync(join(repo.repo, sourcePath));
  status(repo.check(), 0);
  status(repo.hook(), 0);
  assert.doesNotMatch(repo.audit().stdout, /::warning/);
});

test('real pushes validate the pushed branch instead of the checked-out branch', t => {
  const repo = fixture(t);
  const remote = join(repo.directory, 'remote.git');
  repo.git('init', '-q', '--bare', remote);
  repo.git('remote', 'set-url', '--push', 'origin', remote);
  repo.write(archPath, document());
  const valid = repo.commit();
  repo.git('checkout', '-qb', 'invalid');
  repo.write(archPath, '# Invalid architecture\n');
  repo.commit();
  const push = (ref, env) => repo.run('git', ['push', '-q', 'origin', ref], { detached: true, env });
  status(push('main'), 0);
  assert.equal(repo.git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), valid);
  status(push('invalid:main', { ADR_ALLOW_MISSING: '1', ARCH_ALLOW_MISSING: '1' }), 1);
  assert.equal(repo.git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), valid);
  assert.match(repo.audit().stdout, /::warning title=Architecture invalid::/);
  status(repo.hook({ ref: 'refs/heads/topic' }), 0);
});

test('architecture symbolic links are validation errors rather than missing documents', t => {
  const repo = fixture(t);
  repo.write('docs/current.md', document());
  symlinkSync('current.md', join(repo.repo, archPath));
  repo.commit();
  const result = repo.check();
  status(result, 1);
  assert.match(result.stderr, /symbolic link/);
  status(repo.hook({ env: { ARCH_ALLOW_MISSING: '1' } }), 1);
  const audit = repo.audit();
  status(audit, 0);
  assert.match(audit.stdout, /::warning title=Architecture invalid::/);
  assert.doesNotMatch(audit.stdout, /Architecture missing/);
});

test('PlantUML errors block pushes and missing PlantUML produces audit warnings', t => {
  const repo = fixture(t);
  repo.write(archPath, document());
  repo.commit();
  status(repo.check(undefined, { PLANTUML_FAIL: '1' }), 1);
  status(repo.hook({ env: { PLANTUML_FAIL: '1', ARCH_ALLOW_MISSING: '1' } }), 1);
  const failedAudit = repo.audit({ PLANTUML_FAIL: '1' });
  status(failedAudit, 0);
  assert.match(failedAudit.summary, /PlantUML syntax check failed/);
  rmSync(join(repo.bin, 'plantuml'));
  const result = repo.check();
  status(result, 0);
  assert.match(result.stderr, /PlantUML is unavailable/);
  status(repo.hook(), 0);
  const audit = repo.audit();
  status(audit, 0);
  assert.match(audit.stdout, /::warning title=Architecture warning::/);
  assert.match(audit.summary, /syntax validation was not performed/);
});

test('validator launch failure cleans the snapshot and remains non-blocking in audit', t => {
  const repo = fixture(t);
  repo.write(archPath, document());
  repo.commit();
  rmSync(join(repo.repo, checksPath, 'create-update-architecture-md/scripts/validate-arch.mjs'));
  status(repo.check(), 1);
  const audit = repo.audit();
  status(audit, 0);
  assert.match(audit.stdout, /::warning title=Architecture invalid::/);
});

test('invalid revisions fail checks while audit infrastructure errors remain warnings', t => {
  const repo = fixture(t);
  for (const revision of ['', 'HEAD', '0'.repeat(repo.base.length), repo.git('rev-parse', 'HEAD^{tree}')])
    status(repo.check(revision), 1);
  const audit = repo.audit({ GITHUB_STEP_SUMMARY: repo.directory });
  status(audit, 0);
  assert.match(audit.stdout, /::warning title=Architecture audit error::/);
  assert.match(audit.stdout, /::warning title=Architecture summary error::/);
});
