import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packagePath = fileURLToPath(new URL('../', import.meta.url));
const adrPackage = fileURLToPath(new URL('../../create-adr-md/', import.meta.url));
const template = readFileSync(join(packagePath, 'templates/arch.md'), 'utf8');
const archPath = 'docs/ARCHITECTURE.md';
const sourcePath = 'src/cache.mjs';
const sourceText = 'export const cache = new Map();\n\nexport function reset() { cache.clear(); }\n';
const contextSource = '@startuml\nactor Operator\nrectangle Service\nOperator --> Service\n@enduml\n';
const componentSource = '@startuml\ncomponent API\ncomponent Cache\nAPI --> Cache\n@enduml\n';
const diagram = (source, fence = '```') => `${fence}plantuml\n${source}${fence}`;

function document(path = archPath) {
  const sourceLink = `[${sourcePath}:1](${relative(dirname(path), sourcePath)}#L1)`;
  const contents = [
    `The service stores a cached value. ${sourceLink}`,
    'The operator calls the service.',
    diagram(contextSource),
    'The service returns a value to the operator.',
    `The source directory contains the service. ${sourceLink}`,
    `The API owns the shared cache. ${sourceLink}`,
    diagram(componentSource),
    'The API reads values from the cache.',
    `The module creates the cache when it loads. ${sourceLink}`,
    `The cache stores values in memory. ${sourceLink}`,
    'Not recorded. The repository gives no reason for the cache design.',
    'Not applicable. The module has no external dependencies.',
    'Not recorded. The repository gives no capacity limit.',
  ];
  let index = 0;
  return template.replace(/<[^<>\n]+>/g, () => contents[index++]);
}

function adrDocument(sha) {
  return `# ADR-0001: Cache

**Status:** Accepted
**Date:** 2026-11-21
**Record Type:** Agent-Session
**Evidence:** Git History

## Context

Not recorded.

## Decision

Use a shared cache.

## Rationale

Not recorded.

## Alternatives

Not recorded.

## Consequences

Not recorded.

## Implementation

Cache stores values.

## Related Symbols

| Symbol | File | Type | Lines |
|---|---|---|---|
| \`cache\` | \`src/cache.mjs\` | constant | \`1\` |

## Implementation Commit

- https://github.com/example/arch-tests/commit/${sha}
`;
}

function fixture(t, { adr = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'arch-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'target repository');
  const bin = join(directory, 'bin');
  const log = join(directory, 'plantuml.jsonl');
  mkdirSync(repo);
  mkdirSync(bin);
  const gitExecutable = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  symlinkSync(gitExecutable, join(bin, 'git'));
  symlinkSync(process.execPath, join(bin, 'node'));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(?:GIT_|GITHUB_|ADR_|PLANTUML_)/.test(key)));
  Object.assign(env, {
    PATH: bin,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Architecture Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Architecture Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  });
  cpSync(packagePath, join(repo, 'architecture skill'), { recursive: true });
  if (adr) cpSync(adrPackage, join(repo, 'adr skill'), { recursive: true });
  const git = (...args) => execFileSync('git', args, {
    cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const run = (args, options = {}) => spawnSync(process.execPath, args, {
    cwd: repo, env, encoding: 'utf8', ...options,
  });
  const write = (path, contents) => {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  const plantuml = (settings = {}) => {
    writeFileSync(join(bin, 'plantuml'), `#!/usr/bin/env node
const fs = require('node:fs');
const settings = ${JSON.stringify(settings)};
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify({ args, input }) + '\\n');
if (args.includes('-version')) {
  if (settings.removeAfterVersion) fs.unlinkSync(process.argv[1]);
  process.stdout.write(settings.versionOutput ?? 'PlantUML version 1.2026.4 (test)\\n');
  process.exit(settings.versionStatus ?? 0);
}
const index = calls.filter(call => call.args.includes('-syntax')).length;
const result = settings.results?.[index] ?? {};
process.stdout.write(result.stdout ?? 'COMPONENT\\n(2 entities)\\n');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 0);
`, { mode: 0o755 });
  };
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const validator = join(repo, 'architecture skill/scripts/validate-arch.mjs');
  const validate = (path = archPath, args = [], options = {}) => run([
    validator, path, '--repo', '.', ...args,
  ], options);
  git('init', '-q', '--initial-branch=main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('remote', 'add', 'origin', 'https://github.com/example/arch-tests.git');
  write(sourcePath, sourceText);
  git('add', sourcePath);
  git('commit', '-qm', 'Implementation fixture');
  const sha = git('rev-parse', 'HEAD');
  plantuml();
  write(archPath, document());
  return { directory, repo, bin, env, validator, sha, run, write, plantuml, calls, validate };
}

function status(result, expected) {
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
}

test('validates an independently installed skill and both diagram inputs', t => {
  const repo = fixture(t);
  const result = repo.validate();
  status(result, 0);
  assert.match(result.stdout, /^PASS: ARCHITECTURE/m);
  assert.match(result.stdout, /PASS: PlantUML syntax: 2 diagram/);
  assert.match(result.stdout, /^NOTE:.*facts.*ASD-STE100/m);
  assert.equal(result.stderr, '');
  assert.deepEqual(repo.calls().filter(call => call.args.includes('-syntax')).map(call => call.input),
    [contextSource, componentSource]);
  assert.equal(repo.calls().filter(call => call.args.includes('-version')).length, 1);
});

for (const [name, change, error] of [
  ['title', text => text.replace('# Architecture', '# Other'), /First line must be/],
  ['LF', text => text.replaceAll('\n', '\r\n'), /Use LF line endings/],
  ['missing section', text => text.replace('## Data and state\n', ''), /Sections must appear exactly once/],
  ['duplicate section', text => `${text}\n## Overview\n\nDuplicate.\n`, /Sections must appear exactly once/],
  ['section order', text => text.replace('## Overview', '## Temporary')
    .replace('## Repository structure', '## Overview').replace('## Temporary', '## Repository structure'),
  /Sections must appear exactly once/],
  ['extra heading', text => `${text}\n### Extra\n`, /Unexpected Markdown heading/],
  ['empty section', text => text.replace('Not recorded. The repository gives no capacity limit.', ' \t '),
    /Known constraints section is missing or empty/],
  ['template placeholder', text => text.replace('The operator calls the service.',
    '<Describe the system boundary, users, and external systems.>'), /System context contains a placeholder/],
  ['placeholder before sections', text => text.replace('## Overview',
    '<Describe the purpose and main functions of the system.>\n\n## Overview'), /header contains a placeholder/],
  ['heading hidden in code', text => text.replace('## Known constraints', '```text\n## Known constraints\n```'),
    /Sections must appear exactly once/],
]) {
  test(`rejects invalid ${name}`, t => {
    const repo = fixture(t);
    repo.write(archPath, change(document()));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
    assert.match(result.stderr, /^FAIL: \d+ ARCHITECTURE validation error\(s\)/m);
  });
}

for (const [label, target, error] of [
  ['src/cache.mjs:1', '../src/missing.mjs#L1', /does not match/],
  ['src/missing.mjs:1', '../src/missing.mjs#L1', /Source file does not exist with exact case/],
  ['src/Cache.mjs:1', '../src/Cache.mjs#L1', /Source file does not exist with exact case/],
  ['Src/cache.mjs:1', '../Src/cache.mjs#L1', /Source file does not exist with exact case/],
  ['src:1', '../src#L1', /Source file does not exist with exact case/],
  ['src/cache.mjs:4', '../src/cache.mjs#L4', /line is outside source file/],
  ['src/cache.mjs:0', '../src/cache.mjs#L0', /Invalid source link/],
  ['src/cache.mjs:01', '../src/cache.mjs#L01', /Invalid source link/],
  ['src/cache.mjs:9007199254740993', '../src/cache.mjs#L9007199254740993', /Invalid source link/],
  ['src/cache.mjs:1', '../src/cache.mjs#L2', /Invalid source link/],
  ['src/cache.mjs:1', '../src/cache.mjs', /Invalid source link/],
  ['src/cache.mjs:1', '/src/cache.mjs#L1', /Invalid source link/],
  ['src/cache.mjs:1', 'https://example.com/src/cache.mjs#L1', /Invalid source link/],
  ['src/cache.mjs:1', '../src/cache.mjs?plain=1#L1', /Invalid source link/],
  ['outside.mjs:1', '../../outside.mjs#L1', /outside the Git repository/],
  ['src/cache.mjs:1', '../src/%2Fcache.mjs#L1', /Invalid source link/],
  ['src/cache.mjs:1', '../src/%zz.mjs#L1', /Invalid source link/],
]) {
  test(`rejects source citation [${label}](${target})`, t => {
    const repo = fixture(t);
    repo.write(archPath, `${document()}\n[${label}](${target})\n`);
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
  });
}

test('validates Markdown links and encoded paths with spaces and brackets', t => {
  const repo = fixture(t);
  repo.write('docs/adr/0001-cache.md', '# Cache\n\nUse the cache.\n');
  repo.write('src/[cache] map #1.mjs', sourceText);
  repo.write(archPath, `${document()}\n` +
    '[docs/adr/0001-cache.md:3](adr/0001-cache.md?plain=1#L3)\n' +
    '[src/[cache] map #1.mjs:1](../src/%5Bcache%5D%20map%20%231.mjs#L1)\n');
  status(repo.validate(), 0);
  repo.write(archPath, `${document()}\n[docs/adr/0001-cache.md:3](adr/0001-cache.md#L3)\n`);
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, /Invalid source link/);
});

test('counts source lines like ADR, including CRLF and the final newline', t => {
  const repo = fixture(t);
  repo.write(sourcePath, sourceText.replaceAll('\n', '\r\n'));
  repo.write(archPath, `${document()}\n[src/cache.mjs:3](../src/cache.mjs#L3)\n`);
  status(repo.validate(), 0);
  repo.write(sourcePath, '');
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, /line is outside source file/);
});

test('ignores source examples in fenced and inline code and permits ordinary links', t => {
  const repo = fixture(t);
  repo.write(archPath, `${document()}\n` +
    'See [documentation](https://example.com) and [README](../README.md).\n' +
    '`[src/missing.mjs:99](../src/missing.mjs#L99)`\n' +
    '~~~~markdown\n### Example\n[src/missing.mjs:99](../src/missing.mjs#L99)\n~~~~\n');
  status(repo.validate(), 0);
});

test('rejects an unclosed source citation', t => {
  const repo = fixture(t);
  repo.write(archPath, `${document()}\n[src/cache.mjs:1](../src/cache.mjs#L1\n`);
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, /Invalid source link/);
});

test('accepts parentheses in source paths', t => {
  const repo = fixture(t);
  repo.write('src/(cache (local)).mjs', sourceText);
  repo.write(archPath, `${document()}\n[src/(cache (local)).mjs:1](../src/(cache%20(local)).mjs#L1)\n`);
  status(repo.validate(), 0);
  repo.write('src/(cache (local)).mjs', '');
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, /line is outside source file/);
});

for (const target of ['cache.mjs', 'missing.mjs']) {
  test(`rejects a source symbolic link to ${target}`, t => {
    const repo = fixture(t);
    symlinkSync(target, join(repo.repo, 'src/alias.mjs'));
    repo.write(archPath, `${document()}\n[src/alias.mjs:1](../src/alias.mjs#L1)\n`);
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /Source file does not exist with exact case/);
  });
}

test('rejects a source path through a symbolic-link directory', t => {
  const repo = fixture(t);
  symlinkSync('src', join(repo.repo, 'alias'));
  repo.write(archPath, `${document()}\n[alias/cache.mjs:1](../alias/cache.mjs#L1)\n`);
  status(repo.validate(), 1);
});

for (const [name, change, error] of [
  ['missing context diagram', text => text.replace(diagram(contextSource), ''), /System context requires/],
  ['wrong diagram section', text => text.replace(diagram(contextSource), '') + '\n' + diagram(contextSource),
    /System context requires/],
  ['unclosed fence', text => `${text}\n\`\`\`plantuml\n${contextSource}`, /not closed/],
  ['extra info', text => text.replace('```plantuml', '```plantuml title'), /info string must contain only plantuml/],
  ['empty body', text => text.replace(contextSource, '@startuml\n@enduml\n'), /meaningful content/],
  ['comment-only body', text => text.replace(contextSource, "@startuml\n' comment\n@enduml\n"), /meaningful content/],
  ['missing start', text => text.replace('@startuml\n', ''), /exactly one @startuml/],
  ['extra start', text => text.replace('@startuml\n', '@startuml\n@startuml\n'), /exactly one @startuml/],
  ['missing end', text => text.replace('@enduml\n', ''), /exactly one @startuml/],
  ['extra end', text => text.replace('@enduml\n', '@enduml\n@enduml\n'), /exactly one @startuml/],
  ['list container', text => text.replace(diagram(contextSource),
    '- Diagram\n\n' + diagram(contextSource).split('\n').map(line => `  ${line}`).join('\n')),
    /top-level|System context requires/],
  ['quote container', text => text.replace(diagram(contextSource),
    diagram(contextSource).split('\n').map(line => `> ${line}`).join('\n')),
    /top-level|System context requires/],
  ['additional nested quote', text => `${text}\n` +
    diagram(contextSource).split('\n').map(line => `> > ${line}`).join('\n'), /top-level/],
]) {
  test(`rejects PlantUML ${name}`, t => {
    const repo = fixture(t);
    repo.write(archPath, change(document()));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
  });
}

for (const directive of ['!include file.puml', '!includeurl https://example.com/file',
  '!include_once file.puml', '!include_many file.puml', '!import file.puml']) {
  test(`rejects ${directive} before invoking PlantUML on that block`, t => {
    const repo = fixture(t);
    repo.write(archPath, document().replace('actor Operator', `${directive}\nactor Operator`));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /external directive/);
    assert.ok(repo.calls().filter(call => call.args.includes('-syntax'))
      .every(call => !call.input.includes(directive)));
  });
}

for (const fence of ['```', '~~~~', '   ```']) {
  test(`accepts CommonMark fence ${JSON.stringify(fence)}`, t => {
    const repo = fixture(t);
    const indent = fence.match(/^ */)[0];
    const block = `${fence}PlAnTuMl\n` + contextSource.split('\n').slice(0, -1)
      .map(line => `${indent}${line}`).join('\n') + `\n${fence}${fence.trim()[0]}\n`;
    repo.write(archPath, document().replace(diagram(contextSource), block));
    status(repo.validate(), 0);
    assert.equal(repo.calls().find(call => call.args.includes('-syntax')).input, contextSource);
  });
}

test('removes up to the opening fence indentation from each source line', t => {
  const repo = fixture(t);
  const source = '@startuml\n component API\n  component Cache\nAPI --> Cache\n@enduml\n';
  const block = `   \`\`\`plantuml\n${source}   \`\`\`\n`;
  repo.write(archPath, document().replace(diagram(contextSource), block));
  status(repo.validate(), 0);
  assert.equal(repo.calls().find(call => call.args.includes('-syntax')).input,
    '@startuml\ncomponent API\ncomponent Cache\nAPI --> Cache\n@enduml\n');
});

test('checks additional diagrams and continues after a syntax failure', t => {
  const repo = fixture(t);
  repo.plantuml({ results: [{ status: 1, stdout: 'ERROR\nSyntax Error?\n' }] });
  repo.write(archPath, `${document()}\n${diagram('@startuml\nclass Extra\n@enduml\n')}\n`);
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, /PlantUML.*System context/);
  assert.equal(repo.calls().filter(call => call.args.includes('-syntax')).length, 3);
});

for (const failure of [
  { stdout: 'ERROR\nSyntax Error?\n', status: 0 },
  { stderr: 'ERROR\nSyntax Error?\n', status: 0 },
  { stdout: '', status: 7 },
]) {
  test(`rejects failed syntax result ${JSON.stringify(failure)}`, t => {
    const repo = fixture(t);
    repo.plantuml({ results: [failure, failure] });
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /PlantUML.*System context/);
    assert.match(result.stderr, /PlantUML.*System components/);
  });
}

for (const [versionOutput, warning] of [
  ['PlantUML version 1.2026.4 (test)\n', false],
  ['PlantUML version 1.2026.10 (test)\n', false],
  ['PlantUML version 1.2027.1 (test)\n', false],
  ['PlantUML version 1.2026.3 (test)\n', true],
  ['PlantUML version 1.2025.12 (test)\n', true],
  ['Unknown version\n', true],
]) {
  test(`uses installed PlantUML with ${versionOutput.trim()}`, t => {
    const repo = fixture(t);
    repo.plantuml({ versionOutput });
    const result = repo.validate();
    status(result, 0);
    assert.equal(/^WARN:/m.test(result.stderr), warning);
    assert.equal(repo.calls().filter(call => call.args.includes('-syntax')).length, 2);
  });
}

for (const unavailable of ['missing executable', 'failed version probe']) {
  test(`continues document validation with ${unavailable}`, t => {
    const repo = fixture(t);
    if (unavailable === 'missing executable') rmSync(join(repo.bin, 'plantuml'));
    else repo.plantuml({ versionStatus: 1 });
    const result = repo.validate();
    status(result, 0);
    assert.match(result.stderr, /^WARN:.*syntax validation was not performed/m);
    assert.match(result.stderr, /Install PlantUML 1\.2026\.4 or newer/);
    assert.doesNotMatch(result.stdout, /PASS: PlantUML/);
    repo.write(archPath, `${document()}\n[src/missing.mjs:1](../src/missing.mjs#L1)\n`);
    const invalid = repo.validate();
    status(invalid, 1);
    assert.match(invalid.stderr, /Source file does not exist/);
    assert.match(invalid.stderr, /^WARN:/m);
    repo.write(archPath, document().replace(diagram(contextSource), ''));
    const missingDiagram = repo.validate();
    status(missingDiagram, 1);
    assert.match(missingDiagram.stderr, /System context requires/);
  });
}

test('continues when PlantUML becomes unavailable after the version probe', t => {
  const repo = fixture(t);
  repo.plantuml({ removeAfterVersion: true });
  const result = repo.validate();
  status(result, 0);
  assert.match(result.stderr, /^WARN:.*System context/m);
  assert.match(result.stderr, /^WARN:.*System components/m);
  assert.match(result.stderr, /Install PlantUML/);
  assert.doesNotMatch(result.stdout, /PASS: PlantUML/);
});

test('uses the existing document location and resolves --repo like ADR', t => {
  const repo = fixture(t);
  repo.write('ARCHITECTURE.md', document('ARCHITECTURE.md'));
  status(repo.validate('ARCHITECTURE.md'), 0);
  status(repo.run([repo.validator, archPath, '--repo', repo.repo], { cwd: repo.directory }), 0);
  status(repo.run([repo.validator, join(repo.repo, archPath)], { cwd: join(repo.repo, 'src') }), 0);
  status(repo.run([repo.validator, '../docs/ARCHITECTURE.md'], { cwd: join(repo.repo, 'src') }), 0);
  writeFileSync(join(repo.directory, 'ARCHITECTURE.md'), document());
  const result = repo.validate('../ARCHITECTURE.md');
  status(result, 1);
  assert.match(result.stderr, /inside the Git repository/);
});

test('importing the validator is silent and preserves the exit code', t => {
  const repo = fixture(t);
  for (const exitCode of [0, 7]) {
    const result = repo.run(['--input-type=module', '--eval',
      `process.exitCode = ${exitCode}; await import(${JSON.stringify(pathToFileURL(repo.validator).href)});`]);
    status(result, exitCode);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('matches ADR exit codes and diagnostics for common CLI and document failures', t => {
  const repo = fixture(t, { adr: true });
  const adrValidator = join(repo.repo, 'adr skill/scripts/validate-adr.mjs');
  const adrPath = 'docs/adr/0001-cache.md';
  const validAdr = adrDocument(repo.sha);
  repo.write(adrPath, validAdr);
  const cases = [
    [[], 2, /^Error:/m],
    [['--unknown'], 2, /^Error: Unknown option/m],
    [['--repo'], 2, /^Error: Missing value/m],
    [['--help'], 0, /^Usage:/m],
    [['-h'], 0, /^Usage:/m],
    [['missing.md'], 1, /^ERROR:.*does not exist/m],
    [['missing.md', 'extra.md'], 2, /^Error: Provide exactly one/m],
  ];
  for (const [args, expected, message] of cases) {
    for (const validator of [repo.validator, adrValidator]) {
      const result = repo.run([validator, ...args]);
      status(result, expected);
      assert.match(result.stdout + result.stderr, message);
    }
  }
  for (const validator of [repo.validator, adrValidator]) {
    const result = repo.run([validator, 'file.md'], { cwd: repo.directory });
    status(result, 2);
    assert.match(result.stderr, /^Error:.*Git worktree/m);
  }
  for (const [archChange, adrChange, expected, message] of [
    [text => text, text => text, 0, /^PASS:/m],
    [text => text.replaceAll('\n', '\r\n'), text => text.replaceAll('\n', '\r\n'), 1, /Use LF line endings/],
    [text => text.replace('## Overview', '## Other'), text => text.replace('## Context', '## Other'),
      1, /Sections must appear exactly once/],
    [text => `${text}\n### Extra\n`, text => `${text}\n### Extra\n`, 1, /Unexpected Markdown heading/],
    [text => text + '\n[src/Cache.mjs:1](../src/Cache.mjs#L1)\n',
      text => text.replace('`src/cache.mjs`', '`src/Cache.mjs`'), 1, /Source file does not exist with exact case/],
    [text => text + '\n[src/cache.mjs:4](../src/cache.mjs#L4)\n',
      text => text.replace('| constant | `1` |', '| constant | `4` |'), 1, /line is outside source file/],
  ]) {
    repo.write(archPath, archChange(document()));
    repo.write(adrPath, adrChange(validAdr));
    for (const [validator, path] of [[repo.validator, archPath], [adrValidator, adrPath]]) {
      const result = repo.run([validator, path]);
      status(result, expected);
      assert.match(result.stdout + result.stderr, message);
    }
  }
  for (const [validator, path] of [[repo.validator, archPath], [adrValidator, adrPath]]) {
    const alias = path.replace('.md', '-alias.md');
    symlinkSync(join(repo.repo, path), join(repo.repo, alias));
    const result = repo.run([validator, alias]);
    status(result, 1);
    assert.match(result.stderr, /symbolic link/);
  }
});
