import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { AGENTS, SKILLS, commitSummary, install } from '../lib/install.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const checksPath = '.github/scripts/adr-me';
const resources = {
  'create-adr-md': ['scripts/validate-adr.mjs', 'templates/adr.md', 'references/types.md'],
  'create-update-architecture-md': ['scripts/validate-arch.mjs', 'templates/arch.md'],
  'extract-codebase-rules': ['scripts/validate-codebase-rules.mjs', 'templates/cons.md', 'templates/conv.md'],
};

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'adr-me-install-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, 'target repository');
  const userDirectory = join(directory, 'home');
  mkdirSync(repository);
  mkdirSync(userDirectory);
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  git('init', '-q', '--initial-branch=main');
  const write = (path, data) => {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), data);
  };
  const setup = (choices = {}) => install({
    agents: Object.keys(AGENTS), scope: 'project', skills: SKILLS,
    hook: true, actions: true, codePaths: ['src/'], ...choices,
  }, { repository, userDirectory });
  return { repository, userDirectory, git, write, setup };
}

for (const scope of ['project', 'global']) {
  for (const skills of [...Object.keys(resources).map(skill => [skill]), SKILLS]) {
    for (const [hook, actions] of [[false, false], [true, false], [false, true], [true, true]]) {
      test(`${scope} ${skills.join(', ')} with hook=${hook} actions=${actions}`, t => {
        const repo = fixture(t);
        const components = repo.setup({ scope, skills, hook, actions });
        const adr = skills.includes('create-adr-md');
        const arch = skills.includes('create-update-architecture-md');
        const hasChecks = (adr || arch) && (hook || actions);
        for (const component of components) assert.equal(component.status, 'installed', `${component.name}: ${component.reason}`);
        assert.equal(existsSync(join(repo.repository, '.adr-me')), false);
        assert.equal(existsSync(join(repo.repository, checksPath)), hasChecks);
        if (!hasChecks) assert.ok(components.every(({ kind }) => kind === 'skill'));

        for (const agent of Object.keys(AGENTS)) {
          const base = join(scope === 'project' ? repo.repository : repo.userDirectory, AGENTS[agent][scope]);
          for (const skill of Object.keys(resources)) {
            assert.equal(existsSync(join(base, skill)), skills.includes(skill));
            if (!skills.includes(skill)) continue;
            assert.ok(existsSync(join(base, skill, 'SKILL.md')));
            assert.equal(existsSync(join(base, skill, 'tests')), false);
            for (const resource of resources[skill]) {
              const installed = join(repo.repository, checksPath, skill, resource);
              const agentFile = join(base, skill, resource);
              assert.ok(existsSync(agentFile), agentFile);
              const shared = hasChecks && skill !== 'extract-codebase-rules';
              assert.equal(existsSync(installed), shared);
              if (shared) assert.deepEqual(readFileSync(installed), readFileSync(agentFile));
            }
          }
        }

        for (const skill of SKILLS) {
          assert.equal(existsSync(join(repo.repository, checksPath, skill)), hasChecks && skills.includes(skill) && skill !== 'extract-codebase-rules');
          assert.equal(existsSync(join(repo.repository, checksPath, skill, 'SKILL.md')), false);
          assert.equal(existsSync(join(repo.repository, checksPath, skill, 'tests')), false);
        }
        for (const [script, expected] of [
          ['adr-policy.mjs', adr && (hook || actions)], ['check-adr.mjs', adr && hook],
          ['audit-adr.mjs', adr && actions], ['check-architecture.mjs', arch && (hook || actions)],
        ]) assert.equal(existsSync(join(repo.repository, checksPath, script)), expected);

        const hookPath = join(repo.repository, repo.git('rev-parse', '--git-path', 'hooks/pre-push'));
        assert.equal(existsSync(hookPath), hasChecks && hook);
        if (hasChecks && hook) {
          assert.ok(statSync(hookPath).mode & 0o100);
          const content = readFileSync(hookPath, 'utf8');
          assert.equal(content.includes(`${checksPath}/check-adr.mjs`), adr);
          assert.equal(content.includes(`${checksPath}/check-architecture.mjs`), arch);
        }
        const workflow = join(repo.repository, '.github/workflows/adr-check.yml');
        assert.equal(existsSync(workflow), hasChecks && actions);
        if (hasChecks && actions) {
          const content = readFileSync(workflow, 'utf8');
          assert.equal(content.includes(`${checksPath}/audit-adr.mjs`), adr);
          assert.equal(content.includes(`${checksPath}/check-architecture.mjs --audit`), arch);
        }
        if (adr && (hook || actions)) assert.ok(readFileSync(join(repo.repository, checksPath, 'adr-policy.mjs'), 'utf8')
          .includes('const CODE_PATHS = ["src/"];'));
        const { status } = commitSummary(components, repo.repository);
        assert.equal(status.includes(`${checksPath}/`), hasChecks);
        assert.ok(!status.includes('.adr-me/'));
        assert.ok(!status.includes('.git/hooks/'));
      });
    }
  }
}

test('All adds the codebase rules skill and keeps the same push checks', t => {
  const repo = fixture(t);
  const initial = repo.setup({ skills: ['create-adr-md', 'create-update-architecture-md'] });
  const all = repo.setup();
  const checks = components => components.filter(({ kind }) => kind !== 'skill');
  const expected = checks(initial).flatMap(({ written }) => written).sort();
  assert.ok(expected.length > 0);
  assert.ok(checks(all).every(({ status }) => status === 'unchanged'));
  assert.deepEqual(checks(all).flatMap(({ identical }) => identical).sort(), expected);
  for (const { project } of Object.values(AGENTS))
    assert.ok(existsSync(join(repo.repository, project, 'extract-codebase-rules', 'SKILL.md')));
});

test('repeating installation keeps identical files and restores missing files', t => {
  const repo = fixture(t);
  repo.setup();
  assert.ok(repo.setup().every(({ status }) => status === 'unchanged'));
  rmSync(join(repo.repository, checksPath, 'check-adr.mjs'));
  const components = repo.setup();
  assert.equal(components.flatMap(({ written }) => written).length, 1);
  assert.ok(existsSync(join(repo.repository, checksPath, 'check-adr.mjs')));
  assert.ok(components.every(({ status }) => ['installed', 'unchanged'].includes(status)));
});

test('a conflicting shared dependency skips hook and workflow installation', t => {
  const repo = fixture(t);
  const config = `${checksPath}/adr-policy.mjs`;
  repo.write(config, '// User configuration\n');
  const components = repo.setup();
  assert.equal(readFileSync(join(repo.repository, config), 'utf8'), '// User configuration\n');
  for (const kind of ['hook', 'workflow']) assert.equal(components.find(component => component.kind === kind).status, 'skipped');
  assert.equal(existsSync(join(repo.repository, '.git/hooks/pre-push')), false);
  assert.equal(existsSync(join(repo.repository, '.github/workflows/adr-check.yml')), false);
});

test('conflicting hook and workflow files are kept', t => {
  const repo = fixture(t);
  const paths = ['.git/hooks/pre-push', '.github/workflows/adr-check.yml'];
  for (const path of paths) repo.write(path, '// User file\n');
  const components = repo.setup();
  for (const path of paths) assert.equal(readFileSync(join(repo.repository, path), 'utf8'), '// User file\n');
  for (const kind of ['hook', 'workflow']) assert.equal(components.find(component => component.kind === kind).status, 'skipped');
});

test('a conflicting agent skill does not prevent independent components', t => {
  const repo = fixture(t);
  const path = '.agents/skills/create-adr-md/SKILL.md';
  repo.write(path, 'User skill\n');
  const components = repo.setup();
  assert.equal(components.find(({ name }) => name === 'Codex: create-adr-md').status, 'skipped');
  assert.equal(readFileSync(join(repo.repository, path), 'utf8'), 'User skill\n');
  assert.equal(existsSync(join(repo.repository, '.agents/skills/create-adr-md/scripts')), false);
  assert.ok(components.filter(({ name }) => name !== 'Codex: create-adr-md').every(({ status }) => status === 'installed'));
});
