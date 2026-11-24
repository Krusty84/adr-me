import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packagePath = fileURLToPath(new URL('../', import.meta.url));
const source = fileURLToPath(new URL('../../', import.meta.url));
const template = readFileSync(join(packagePath, 'templates', 'adr.md'), 'utf8');
const adrPath = 'docs/adr/0001-cache.md';
const relatedTableHeader = '| Symbol | File | Type | Lines |\n|---|---|---|---|';
const relatedSymbolsTemplate = '## Related Symbols\n\n' +
  `${relatedTableHeader}\n` +
  '| `<QualifiedName>` | `<repository-relative-path>` | <type-from-types.md> | ' +
  '[<repository-relative-path>:<line-number>](<relative-source-path>#L<line-number>) |\n\n';
const tableCell = value => value.replaceAll('|', '\\|');
const relatedRow = (symbol = 'cache', file = 'src/cache.mjs', type = 'constant', lines = '1', link = null) => {
  const lineCell = link ? `[${tableCell(file)}:${lines}](${link})` : `\`${lines}\``;
  return `| \`${tableCell(symbol)}\` | \`${tableCell(file)}\` | ${type} | ${lineCell} |`;
};
const relatedTable = (rows = relatedRow()) => `${relatedTableHeader}\n${rows}`;
const typeCatalog = readFileSync(join(packagePath, 'references', 'types.md'), 'utf8');
const catalogTypes = [...new Set(
  [...typeCatalog.matchAll(/^\| `([a-z]+(?:-[a-z]+)*)` \|/gm)].map(match => match[1]),
)];

function document(links, {
  recordType = 'Agent-Session', title = 'Cache', context = 'Not recorded.', relatedSymbols = null,
} = {}) {
  return template
    .replace('<Short decision title>', title)
    .replace('YYYY-MM-DD', '2026-11-17')
    .replace('<Agent-Session | Retrospective>', recordType)
    .replace('<Agent Session | Git History | Manual | Mixed>', 'Git History')
    .replace('<Problem and constraints, or "Not recorded.">', context)
    .replace('<One approved technical decision.>', 'Use a shared cache.')
    .replace('<Supported reasons, or "Not recorded.">', 'Not recorded.')
    .replace('<Rejected alternatives and reasons, or "Not recorded.">', 'Not recorded.')
    .replace('<Known effects and risks, or "Not recorded.">', 'Not recorded.')
    .replace('<Verified implementation facts.>', 'Cache stores one value.')
    .replace(relatedSymbolsTemplate, relatedSymbols === null ? '' :
      `## Related Symbols\n\n${relatedSymbols}\n\n`)
    .replace('- https://github.com/OWNER/REPO/commit/<FULL_COMMIT_SHA>', links
      .map(sha => `- https://github.com/example/adr-tests/commit/${sha}`).join('\n'));
}

function relatedDocument(links, body = relatedTable(), before = 'Implementation Commit') {
  const text = document(links, { relatedSymbols: body });
  const section = `## Related Symbols\n\n${body}\n\n`;
  if (before === 'Implementation Commit') return text;
  const withoutSection = text.replace(section, '');
  return before ? withoutSection.replace(`## ${before}\n`, `${section}## ${before}\n`) :
    `${withoutSection}\n${section}`;
}

function fixture(t, objectFormat = 'sha1') {
  const directory = mkdtempSync(join(tmpdir(), 'adr-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'target repository');
  const snapshots = join(directory, 'snapshots');
  mkdirSync(repo);
  mkdirSync(snapshots);
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(?:GIT_|GITHUB_|ADR_|ARCH_)/.test(key)));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'ADR Test',
    GIT_AUTHOR_EMAIL: 'adr-test@example.invalid',
    GIT_COMMITTER_NAME: 'ADR Test',
    GIT_COMMITTER_EMAIL: 'adr-test@example.invalid',
    TMPDIR: snapshots,
    ARCH_ALLOW_MISSING: '1',
  });
  const installed = join(repo, 'create-adr-md');
  cpSync(packagePath, installed, { recursive: true });
  for (const folder of ['.github', '.githooks', 'create-update-architecture-md']) {
    cpSync(join(source, folder), join(repo, folder), { recursive: true });
  }
  const config = join(repo, '.github/scripts/adr-policy.mjs');
  writeFileSync(config, readFileSync(config, 'utf8')
    .replace(/const CODE_PATHS = .*;/, 'const CODE_PATHS = ["src/"];'));
  const git = (...args) => execFileSync('git', args, {
    cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const run = (command, args, options = {}) => spawnSync(command, args, {
    cwd: repo, env, encoding: 'utf8', ...options,
  });
  const write = (path, content) => {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'Fixture change');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '--initial-branch=main', `--object-format=${objectFormat}`);
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '.githooks');
  git('remote', 'add', 'origin', 'https://github.com/example/adr-tests.git');
  const base = commit();
  let value = 0;
  const code = () => {
    write('src/cache.mjs', `export const cache = new Map([['value', ${++value}]]);\n`);
    return commit();
  };
  const implementation = code();
  const validate = (path = adrPath, args = []) => run(process.execPath, [
    'create-adr-md/scripts/validate-adr.mjs', path, '--repo', '.', '--remote', 'origin',
    ...args,
  ]);
  const hook = (before = base) => {
    const result = run(join(repo, '.githooks/pre-push'), ['origin'], {
      input: `refs/heads/main ${git('rev-parse', 'HEAD')} refs/heads/main ${before}\n`,
    });
    assert.deepEqual(readdirSync(snapshots), [], 'Hook removes its validation snapshots');
    return result;
  };
  const audit = () => {
    const summaryPath = join(directory, 'summary.md');
    writeFileSync(summaryPath, '');
    const result = run(process.execPath, ['.github/scripts/audit-adr.mjs'], {
      env: { ...env, GITHUB_REPOSITORY: 'example/adr-tests', GITHUB_STEP_SUMMARY: summaryPath },
    });
    assert.deepEqual(readdirSync(snapshots), [], 'Audit removes its validation snapshots');
    return { ...result, summary: readFileSync(summaryPath, 'utf8') };
  };
  return { directory, repo, base, implementation, git, run, write, commit, code, validate, hook, audit };
}

function status(result, expected) {
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
}

function auditResult(result, missing) {
  status(result, 0);
  assert.ok(result.stdout.includes(`${missing} without ADR.`), result.stdout);
  assert.ok(result.summary.includes(`Missing ADR **${missing}**`), result.summary);
  assert.doesNotMatch(result.summary, /Invalid ADR/i);
  const warnings = result.stdout.split('\n').filter(line => line.startsWith('::warning'));
  assert.equal(warnings.length, missing, result.stdout);
  for (const warning of warnings) assert.match(warning, /^::warning title=ADR missing::/);
}

for (const objectFormat of ['sha1', 'sha256']) {
  for (const recordType of ['Agent-Session', 'Retrospective']) {
    test(`${objectFormat} accepts a regular ${recordType} ADR`, t => {
      const repo = fixture(t, objectFormat);
      repo.write(adrPath, document([repo.implementation], { recordType }));
      repo.commit();
      status(repo.validate(), 0);
      status(repo.hook(), 0);
      auditResult(repo.audit(), 0);
    });
  }
}

for (const field of ['Status', 'Date', 'Record Type', 'Evidence']) {
  for (const variant of ['missing', 'empty', 'whitespace']) {
    test(`rejects ${variant} ${field} through all entry points`, t => {
      const repo = fixture(t);
      const text = document([repo.implementation]).split('\n').flatMap(line => {
        if (!line.startsWith(`**${field}:**`)) return [line];
        if (variant === 'missing') return [];
        const value = variant === 'empty' ? '' : ' \t ';
        return [`**${field}:** ${value}`];
      }).join('\n');
      repo.write(adrPath, text);
      repo.commit();
      const result = repo.validate();
      status(result, 1);
      if (variant !== 'missing') assert.ok(result.stderr.includes(`${field} must have a non-empty value`));
      status(repo.hook(), 1);
      auditResult(repo.audit(), 1);
    });
  }
}

for (const [field, value] of [
  ['Status', 'Draft'], ['Date', '2026-02-30'], ['Record Type', 'Session-Based'], ['Evidence', 'Unknown'],
]) {
  test(`rejects an invalid non-empty ${field}`, t => {
    const repo = fixture(t);
    const text = document([repo.implementation]).split('\n').map(line =>
      line.startsWith(`**${field}:**`) ? `**${field}:** ${value}` : line).join('\n');
    repo.write(adrPath, text);
    repo.commit();
    status(repo.validate(), 1);
    status(repo.hook(), 1);
    auditResult(repo.audit(), 1);
  });
}

for (const target of ['0001-cache.md', 'missing.md']) {
  test(`rejects a symbolic link to ${target} with an explicit error`, t => {
    const repo = fixture(t);
    repo.write(adrPath, document([repo.implementation]));
    const alias = 'docs/adr/0002-alias.md';
    symlinkSync(target, join(repo.repo, alias));
    repo.commit();
    const result = repo.validate(alias);
    status(result, 1);
    assert.match(result.stderr, /symbolic link/i);
    status(repo.hook(), 1);
    auditResult(repo.audit(), 0);
  });
}

test('a later valid reference preserves earlier coverage', t => {
  const repo = fixture(t);
  auditResult(repo.audit(), 1);
  repo.write(adrPath, document([repo.implementation]));
  repo.commit();
  auditResult(repo.audit(), 0);
  const later = repo.code();
  auditResult(repo.audit(), 1);
  repo.write(adrPath, document([repo.implementation, later]));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(later), 0);
  const result = repo.audit();
  auditResult(result, 0);
  assert.ok(!result.summary.includes(later));
  assert.ok(!result.summary.includes(repo.implementation));
});

test('editing an existing ADR can cover new code in the push', t => {
  const repo = fixture(t);
  repo.write(adrPath, document([repo.implementation]));
  const before = repo.commit();
  const later = repo.code();
  repo.write(adrPath, document([repo.implementation, later]));
  repo.commit();
  const result = repo.hook(before);
  status(result, 0);
  assert.ok(result.stdout.includes(later));
  auditResult(repo.audit(), 0);
});

test('a reference to another branch fails history checks', t => {
  const repo = fixture(t);
  repo.git('checkout', '-qb', 'side');
  const side = repo.code();
  repo.git('checkout', '-q', 'main');
  repo.write(adrPath, document([repo.implementation, side]));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 1);
  auditResult(repo.audit(), 1);
});

test('audit checks ancestry at the last ADR change', t => {
  const repo = fixture(t);
  repo.git('checkout', '-qb', 'side');
  repo.write('notes.txt', 'Side branch.\n');
  const side = repo.commit();
  repo.git('checkout', '-q', 'main');
  repo.write(adrPath, document([repo.implementation, side]));
  repo.commit();
  repo.git('merge', '-q', '--no-ff', '-m', 'Merge side branch', 'side');
  status(repo.validate(), 0);
  auditResult(repo.audit(), 1);
});

for (const length of [120, 121]) {
  test(`accepts a ${length}-character title for manual style review`, t => {
    const repo = fixture(t);
    repo.write(adrPath, document([repo.implementation], { title: 'A'.repeat(length) }));
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
  });
}

for (const wordCount of [350, 351]) {
  test(`accepts ${wordCount}-word prose for manual style review`, t => {
    const repo = fixture(t);
    // The title and the other five text sections contain 15 words.
    const context = Array(wordCount - 15).fill('word').join(' ');
    repo.write(adrPath, document([repo.implementation], { context }));
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
  });
}

for (const [name, options] of [
  ['technical notation', {
    title: 'Map<T> cache',
    context: 'Use `Map<string, number>`, <div>{{value}}</div>, and `TODO`, `TBD`, `FIXME` identifiers.',
  }],
  ['non-English text', { context: 'Кэш хранит значения.' }],
]) {
  test(`accepts ${name} without prose heuristics`, t => {
    const repo = fixture(t);
    repo.write(adrPath, document([repo.implementation], options));
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
  });
}

for (const [name, change, error] of [
  ['template title', text => text.replace('# ADR-0001: Cache', '# ADR-0001: <Short decision title>'), /Title contains a placeholder/],
  ['template section', text => text.replace('Use a shared cache.', '<One approved technical decision.>'), /Decision contains a placeholder/],
  ['empty section', text => text.replace('Use a shared cache.', ''), /Decision section is missing or empty/],
  ['missing section', text => text.replace('## Rationale\n', ''), /Sections must appear exactly once/],
  ['reordered sections', text => text.replace('## Context', '## Temporary')
    .replace('## Decision', '## Context').replace('## Temporary', '## Decision'), /Sections must appear exactly once/],
  ['non-HTTPS link', text => text.replace('- https://', '- http://'), /Each Implementation Commit entry must be a bullet/],
  ['short SHA', text => text.replace(/(\/commit\/[0-9a-f]{12})[0-9a-f]+/, '$1'), /Invalid commit URL/],
]) {
  test(`rejects ${name} through all entry points`, t => {
    const repo = fixture(t);
    repo.write(adrPath, change(document([repo.implementation])));
    repo.commit();
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
    status(repo.hook(), 1);
    auditResult(repo.audit(), 1);
  });
}

test('local pushes accept a valid ADR and audit uncovered commits', t => {
  const repo = fixture(t);
  repo.write(adrPath, document([repo.implementation]));
  repo.commit();
  status(repo.validate(), 0);
  const remote = join(repo.directory, 'remote.git');
  repo.git('init', '-q', '--bare', remote);
  repo.git('remote', 'set-url', '--push', 'origin', remote);
  status(repo.run('git', ['push', '-q', 'origin', 'main']), 0);
  auditResult(repo.audit(), 0);
  repo.code();
  status(repo.run('env', ['ADR_ALLOW_MISSING=1', 'git', 'push', '-q', 'origin', 'main']), 0);
  auditResult(repo.audit(), 1);
});

for (const before of ['Context', 'Decision', 'Rationale', 'Alternatives', 'Consequences',
  'Implementation', 'Implementation Commit', null]) {
  test(`accepts Related Symbols ${before ? `before ${before}` : 'at the end'} through all entry points`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation], undefined, before));
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
  });
}

test('accepts an empty Related Symbols section', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation], ''));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

test('accepts a header-only Related Symbols table', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation], relatedTableHeader));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

test('accepts first and last CRLF source lines without a final newline', t => {
  const repo = fixture(t);
  const path = 'src/lines.ts';
  repo.write(path, 'export const first = 1;\r\nexport const last = 2;');
  const implementation = repo.commit();
  const rows = [
    relatedRow('first', path, 'constant', '1'),
    relatedRow('last', path, 'constant', '2'),
  ].join('\n');
  repo.write(adrPath, relatedDocument([repo.implementation, implementation], relatedTable(rows)));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

test('accepts symbols, paths, types, and aligned separators', t => {
  const repo = fixture(t);
  const path = 'src/[pressure]/Pressure Service.ts';
  const operatorsPath = 'src/operators.cpp';
  const swiftPath = 'src/operators.swift';
  repo.write(path, 'export interface Calculator { calculate(): number; }\n' +
    'export class PressureService { #privateFlow = 0; flowRate = 0; calculate() { return this.#privateFlow; } }\n' +
    'export function\n  validatePressure() {}\nexport let pressure = 0;\nexport let Pressure = 0;\n' +
    'export const MAX_PRESSURE = 10;\nexport const presión = 0;\n');
  repo.write(operatorsPath, 'struct Math { Math operator/(int) const; };\n' +
    'struct Bitmask { Bitmask operator |(Bitmask) const; };\n' +
    'struct Callable { void operator()() const; void invoke() const; };\n');
  repo.write(swiftPath, 'infix operator ..<\n');
  const implementation = repo.commit();
  const entries = [
    ['Calculator', 'interface', 1], ['PressureService', 'class', 2],
    ['PressureService.flowRate', 'property', 2], ['PressureService.calculate', 'method', 2],
    ['PressureService.#privateFlow', 'field', 2], ['validatePressure', 'function', 4],
    ['pressure', 'variable', 5], ['Pressure', 'variable', 6],
    ['MAX_PRESSURE', 'constant', 7], ['presión', 'constant', 8],
    ['Math.operator/', 'operator', 1, operatorsPath], ['Bitmask.operator|', 'operator', 2, operatorsPath],
    ['Callable::operator()', 'operator', 3, operatorsPath], ['Callable::invoke', 'method', 3, operatorsPath],
    ['..<', 'operator', 1, swiftPath],
  ];
  const body = '| Symbol | File | Type | Lines |\n|:---|:---:|---:|:---:|\n' + entries
    .map(([symbol, type, lines, file = path]) => relatedRow(symbol, file, type, lines)).join('\n');
  repo.write(adrPath, relatedDocument([repo.implementation, implementation], body));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

test('accepts every type declared by the language catalog', t => {
  const repo = fixture(t);
  assert.ok(catalogTypes.length > 0);
  const path = 'src/catalog.mjs';
  const names = catalogTypes.map((_, index) => `CatalogSymbol${index}`);
  repo.write(path, names.map(name => `export const ${name} = 0;\n`).join(''));
  const implementation = repo.commit();
  const rows = catalogTypes.map((type, index) =>
    relatedRow(names[index], path, type, index + 1)).join('\n');
  repo.write(adrPath, relatedDocument([repo.implementation, implementation], relatedTable(rows)));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

test('rejects a different case or a partial related symbol name', t => {
  const repo = fixture(t);
  const path = 'src/pressure.ts';
  const symbol = 'PressureService.calculate';
  const names = ['Calculate', 'recalculate', 'calculateTotal', 'écalculate', '#calculate'];
  repo.write(path, 'export class PressureService {\n' +
    names.map(name => `  ${name}() {}\n`).join('') + '}\n');
  for (const [index, name] of names.entries()) {
    const line = index + 2;
    const row = relatedRow(symbol, path, 'method', line);
    repo.write(adrPath, relatedDocument([repo.implementation], relatedTable(row)));
    const result = repo.validate();
    status(result, 1);
    assert.ok(result.stderr.includes(`Related symbol name not found on source line: ${symbol} at ${path}:${line}`),
      `Unexpected diagnostic for ${name}: ${result.stderr}`);
  }
});

test('rejects a related operator name that is a prefix of another operator', t => {
  const repo = fixture(t);
  const path = 'src/operators.cpp';
  repo.write(path, 'struct Bitmask { Bitmask operator||(Bitmask) const; };\n');
  const row = relatedRow('Bitmask::operator|', path, 'operator', 1);
  repo.write(adrPath, relatedDocument([repo.implementation], relatedTable(row)));
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, /Related symbol name not found on source line: Bitmask::operator\| at src\/operators\.cpp:1/);
});

test('rejects a stale related symbol line within the source file through all entry points', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation]));
  repo.commit();
  repo.write('src/cache.mjs', 'export const size = 0;\nexport const cache = new Map();\n');
  repo.commit();
  const error = /Related symbol name not found on source line: cache at src\/cache\.mjs:1/;
  const result = repo.validate();
  status(result, 1);
  assert.match(result.stderr, error);
  const hook = repo.hook();
  status(hook, 1);
  assert.match(hook.stderr, error);
  const audit = repo.audit();
  auditResult(audit, 2);
  assert.doesNotMatch(audit.stdout, error);
});

test('accepts relative related symbol links for TypeScript and Swift', t => {
  const repo = fixture(t);
  const entries = [
    ['main', 'src/main.ts', '42', 'export function main() {}\n'],
    ['decode', 'helpers/io/decode.swift', '88', 'func decode() {}\n'],
  ];
  for (const [, path, line, declaration] of entries) {
    repo.write(path, '\n'.repeat(Number(line) - 1) + declaration);
  }
  const implementation = repo.commit();
  const rows = entries.map(([symbol, path, line]) =>
    relatedRow(symbol, path, 'function', line, `../../${path}#L${line}`)).join('\n');
  repo.write(adrPath, relatedDocument([repo.implementation, implementation], relatedTable(rows)));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

for (const [forge, project, route] of [
  ['GitHub', 'https://github.com/example/adr-tests', ''],
  ['GitLab.com', 'https://gitlab.com/example/adr-tests', '/-'],
  ['self-managed GitLab', 'https://git.example.test/example/blob/team/adr-tests', '/-'],
]) {
  test(`checks relative and numeric related symbol lines at the selected revision on ${forge}`, t => {
    const repo = fixture(t);
    repo.git('remote', 'set-url', 'origin', `${project}.git`);
    const path = 'src/[services]/caché #1 (old) % &|?.mjs';
    const encodedPath = 'src/%5Bservices%5D/cach%C3%A9%20%231%20%28old%29%20%25%20%26%7C%3F.mjs';
    repo.write(path, 'export const primary = 0;\nexport const secondary = 1;\n');
    const firstRevision = repo.commit();
    repo.write(path, 'export const secondary = 1;\nexport const primary = 0;\n');
    const currentRevision = repo.commit();
    const link = `../../${encodedPath}#L2`;
    const rows = [
      relatedRow('primary', path, 'constant', '2', link),
      relatedRow('secondary', path),
    ].join('\n');
    const adr = relatedDocument([repo.implementation, firstRevision, currentRevision], relatedTable(rows))
      .replaceAll('https://github.com/example/adr-tests/commit/', `${project}${route}/commit/`);
    repo.write(adrPath, adr);
    repo.commit();

    status(repo.validate(), 0);
    status(repo.validate(adrPath, ['--source-revision', currentRevision]), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);

    const historical = repo.validate(adrPath, ['--source-revision', firstRevision]);
    status(historical, 1);
    assert.ok(historical.stderr.includes(`Related symbol name not found on source line: primary at ${path}:2`),
      historical.stderr);

    repo.write(path, 'export const primary = 0;\nexport const secondary = 1;\n');
    status(repo.validate(), 1);
    status(repo.validate(adrPath, ['--source-revision', currentRevision]), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
  });
}

test('accepts numeric related symbol lines with a non-GitHub remote', t => {
  const repo = fixture(t);
  repo.git('remote', 'set-url', 'origin', 'git@gitlab.com:example/adr-tests.git');
  repo.write(adrPath, relatedDocument([repo.implementation]).replace(
    'https://github.com/example/adr-tests/commit/', 'https://gitlab.com/example/adr-tests/-/commit/',
  ));
  status(repo.validate(), 0);
});

for (const protocol of ['http', 'https']) {
  test(`rejects ${protocol.toUpperCase()} source links through all entry points`, t => {
    const repo = fixture(t);
    const link = `${protocol}://github.com/example/adr-tests/blob/${repo.implementation}/src/cache.mjs#L1`;
    for (const label of ['1', 'src/cache.mjs:1']) {
      const row = relatedRow().replace('`1`', `[${label}](${link})`);
      repo.write(adrPath, relatedDocument([repo.implementation], relatedTable(row)));
      repo.commit();
      const result = repo.validate();
      status(result, 1);
      assert.match(result.stderr, /Invalid related symbol lines:/);
      status(repo.hook(), 1);
      auditResult(repo.audit(), 1);
    }
  });
}

test('rejects invalid relative related symbol links', t => {
  const repo = fixture(t);
  const path = 'src/cache.mjs';
  const invalidLines = /Invalid related symbol lines:/;
  const wrongFile = /Related symbol link does not match File:/;
  for (const [name, cell, error] of [
    ['target file case', `[${path}:1](../../src/Cache.mjs#L1)`, wrongFile],
    ['label file case', `[src/Cache.mjs:1](../../${path}#L1)`, wrongFile],
    ['ADR directory', `[${path}:1](../${path}#L1)`, wrongFile],
    ['outside repository', `[${path}:1](../../../${path}#L1)`, wrongFile],
    ['absolute path', `[${path}:1](/${path}#L1)`, invalidLines],
    ['protocol-relative URL', `[${path}:1](//example.test/${path}#L1)`, invalidLines],
    ['file URL', `[${path}:1](file:///tmp/${path}#L1)`, invalidLines],
    ['line number', `[${path}:1](../../${path}#L2)`, invalidLines],
    ['number-only label', `[1](../../${path}#L1)`, invalidLines],
    ['zero line', `[${path}:0](../../${path}#L0)`, invalidLines],
    ['leading zero', `[${path}:01](../../${path}#L01)`, invalidLines],
    ['range', `[${path}:1](../../${path}#L1-L2)`, invalidLines],
    ['query', `[${path}:1](../../${path}?raw=1#L1)`, invalidLines],
    ['invalid encoding', `[${path}:1](../../src/%ZZ.mjs#L1)`, invalidLines],
    ['encoded slash', `[${path}:1](../../src%2Fcache.mjs#L1)`, invalidLines],
    ['encoded backslash', `[${path}:1](../../src%5Ccache.mjs#L1)`, invalidLines],
  ]) {
    const row = relatedRow().replace('`1`', cell);
    repo.write(adrPath, relatedDocument([repo.implementation], relatedTable(row)));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error, `Unexpected diagnostic for ${name}: ${result.stderr}`);
  }
});

for (const marker of ['```', '~~~~']) {
  test(`ignores fenced examples (${marker}) and prose mentions as exact links`, t => {
    const repo = fixture(t);
    const body = relatedTable() + `\n\n${marker}markdown\n` +
      '| Symbol | File | Type | Lines |\n|---|---|---|---|\n' +
      '| `Missing` | `missing.ts` | class | `1` |\n' + `${marker}\n`;
    const text = relatedDocument([repo.implementation], body).replace('Not recorded.',
      `Call \`cache.get()\` and read \`missingSymbol\`.\n\n${marker}markdown\n` +
      '## Related Symbols\n| Symbol | File | Type | Lines |\n|---|---|---|---|\n' +
      '| `Missing` | `missing.ts` | class | `1` |\n## Implementation Commit\n' +
      '- https://github.com/example/adr-tests/commit/ffffffffffffffffffffffffffffffffffffffff\n' +
      `### Example heading\n${marker}\n`);
    repo.write(adrPath, text);
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
  });
}

for (const symbol of [
  '', 'cache()', '(cache)', 'cache value', 'cache\\value', 'cache:12',
]) {
  test(`rejects malformed related symbol ${JSON.stringify(symbol)}`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation],
      relatedTable(relatedRow(symbol))));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /Invalid related symbol:/);
  });
}

for (const file of [
  'src\\cache.mjs', '/src/cache.mjs', 'C:/src/cache.mjs', '../src/cache.mjs',
  './src/cache.mjs', 'src//cache.mjs', 'src/cache.mjs:12',
]) {
  test(`rejects malformed related file ${file}`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation],
      relatedTable(relatedRow('cache', file))));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /Invalid related symbol file:/);
  });
}

for (const lines of ['0', '-1', '01', '1-2', 'L1']) {
  test(`rejects malformed related lines ${JSON.stringify(lines)}`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation],
      relatedTable(relatedRow('cache', 'src/cache.mjs', 'constant', lines))));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /Invalid related symbol lines:/);
  });
}

for (const [name, body, error] of [
  ['old list format', '- `src/cache.mjs#cache`', /must start with the table header/],
  ['wrong header', '| File | Symbol | Type | Lines |\n|---|---|---|---|', /must start with the table header/],
  ['old three-column table', '| Symbol | File | Type |\n|---|---|---|\n| `cache` | `src/cache.mjs` | constant |', /must start with the table header/],
  ['missing separator', '| Symbol | File | Type | Lines |\n' + relatedRow(), /table separator/],
  ['short separator', '| Symbol | File | Type | Lines |\n|--|---|---|---|', /table separator/],
  ['missing symbol backticks', relatedTable('| cache | `src/cache.mjs` | constant | `1` |'), /Invalid related symbol:/],
  ['missing file backticks', relatedTable('| `cache` | src/cache.mjs | constant | `1` |'), /Invalid related symbol file:/],
  ['missing Lines backticks', relatedTable('| `cache` | `src/cache.mjs` | constant | 1 |'), /Invalid related symbol lines:/],
  ['extra column', relatedTable('| `cache` | `src/cache.mjs` | constant | `1` | note |'), /four columns/],
  ['description line', `${relatedTable()}\nDescription.`, /four columns/],
  ['unknown type', relatedTable(relatedRow('cache', 'src/cache.mjs', 'unknown')), /Invalid related symbol type/],
  ['uppercase type', relatedTable(relatedRow('cache', 'src/cache.mjs', 'Constant')), /Invalid related symbol type/],
  ['duplicate reference', relatedTable(`${relatedRow()}\n${relatedRow('cache', 'src/cache.mjs', 'variable', '2')}`), /Duplicate related symbol/],
  ['line outside source file', relatedTable(relatedRow('cache', 'src/cache.mjs', 'constant', '2')), /Related symbol line is outside source file/],
  ['missing file', relatedTable(relatedRow('cache', 'src/missing.mjs')), /Source file does not exist with exact case/],
  ['wrong filename case', relatedTable(relatedRow('cache', 'src/Cache.mjs')), /Source file does not exist with exact case/],
  ['wrong directory case', relatedTable(relatedRow('cache', 'Src/cache.mjs')), /Source file does not exist with exact case/],
  ['directory', relatedTable(relatedRow('cache', 'src')), /Source file does not exist with exact case/],
  ['linked missing file', relatedTable(relatedRow('cache', 'src/missing.mjs', 'constant', '1', '../../src/missing.mjs#L1')), /Source file does not exist with exact case/],
  ['linked line outside source file', relatedTable(relatedRow('cache', 'src/cache.mjs', 'constant', '2', '../../src/cache.mjs#L2')), /Related symbol line is outside source file/],
  ['linked missing symbol', relatedTable(relatedRow('missing', 'src/cache.mjs', 'constant', '1', '../../src/cache.mjs#L1')), /Related symbol name not found on source line/],
]) {
  test(`rejects ${name} in Related Symbols through all entry points`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation], body));
    repo.commit();
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
    status(repo.hook(), 1);
    auditResult(repo.audit(), 1);
  });
}

test('rejects repeated Related Symbols sections', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation]) + '\n## Related Symbols\n');
  repo.commit();
  status(repo.validate(), 1);
  status(repo.hook(), 1);
  auditResult(repo.audit(), 1);
});

for (const [name, change, error] of [
  ['missing catalog', null, /references\/types\.md does not exist/],
  ['missing language section', text => text.replace('## Go', '## Golang'), /requires one Go section/],
  ['invalid table header', text => text.replace('| Type | Use for |', '| Kind | Use for |'), /must start with the table header/],
  ['duplicate type', text => text.replace('| `class` | A class declaration. |',
    '| `class` | A class declaration. |\n| `class` | Repeated. |'), /repeats symbol type: class/],
]) {
  test(`rejects ${name} in the symbol type catalog`, t => {
    const repo = fixture(t);
    const path = join(repo.repo, 'create-adr-md/references/types.md');
    if (change === null) rmSync(path);
    else repo.write('create-adr-md/references/types.md', change(readFileSync(path, 'utf8')));
    repo.write(adrPath, relatedDocument([repo.implementation]));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
    assert.match(result.stderr, /Invalid symbol type catalog/);
  });
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`${objectFormat} checks source files at the requested revision`, t => {
    const repo = fixture(t, objectFormat);
    repo.write(adrPath, relatedDocument([repo.implementation]));
    repo.commit();
    rmSync(join(repo.repo, 'src/cache.mjs'));
    status(repo.validate(), 1);
    status(repo.validate(adrPath, ['--source-revision', repo.implementation]), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
    const result = repo.validate(adrPath, ['--source-revision', repo.base]);
    status(result, 1);
    assert.match(result.stderr, /Source file does not exist with exact case/);
  });

  test(`${objectFormat} checks source lines at the requested revision`, t => {
    const repo = fixture(t, objectFormat);
    repo.write('src/cache.mjs', 'export const first = 1;\nexport const cache = 2;\n');
    const twoLineRevision = repo.commit();
    repo.write(adrPath, relatedDocument([repo.implementation, twoLineRevision],
      relatedTable(relatedRow('cache', 'src/cache.mjs', 'constant', '2'))));
    repo.commit();
    repo.write('src/cache.mjs', 'export const cache = 1;\nexport const first = 2;\n');
    const workingResult = repo.validate();
    status(workingResult, 1);
    assert.match(workingResult.stderr, /Related symbol name not found on source line: cache at src\/cache\.mjs:2/);
    status(repo.validate(adrPath, ['--source-revision', twoLineRevision]), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0);
    const revisionResult = repo.validate(adrPath, ['--source-revision', repo.implementation]);
    status(revisionResult, 1);
    assert.match(revisionResult.stderr, /Related symbol line is outside source file/);
  });
}

test('committed source deletion is not hidden by an untracked file', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation]));
  rmSync(join(repo.repo, 'src/cache.mjs'));
  repo.commit();
  repo.write('src/cache.mjs', 'export const cache = new Map();\n');
  status(repo.validate(), 0);
  status(repo.hook(), 1);
  auditResult(repo.audit(), 2);
});

test('multiple ADRs can reference the same symbol', t => {
  const repo = fixture(t);
  const text = relatedDocument([repo.implementation]);
  repo.write(adrPath, text);
  repo.write('docs/adr/0002-other-cache.md', text.replace('ADR-0001:', 'ADR-0002:'));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0);
});

test('source revision requires a full local commit SHA', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation]));
  for (const args of [['--source-revision'], ['--source-revision', ''], ['--source-revision', 'HEAD'],
    ['--source-revision', repo.implementation.slice(0, 12)]]) {
    status(repo.validate(adrPath, args), 2);
  }
  for (const revision of ['f'.repeat(repo.implementation.length), repo.git('rev-parse', 'HEAD^{tree}')]) {
    const result = repo.validate(adrPath, ['--source-revision', revision]);
    status(result, 1);
    assert.match(result.stderr, /Source revision is not a local commit/);
  }
});
