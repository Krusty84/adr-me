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
const relatedSymbolsTemplate = '## Related Symbols\n\n' +
  '- `<repository-relative-path#QualifiedName>` — ' +
  '<Optional English description. Delete this section when no links are confirmed.>\n\n';

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

function relatedDocument(links, body = '- `src/cache.mjs#cache`', before = 'Implementation Commit') {
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
    .filter(([key]) => !/^(?:GIT_|GITHUB_|ADR_)/.test(key)));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'ADR Test',
    GIT_AUTHOR_EMAIL: 'adr-test@example.invalid',
    GIT_COMMITTER_NAME: 'ADR Test',
    GIT_COMMITTER_EMAIL: 'adr-test@example.invalid',
    TMPDIR: snapshots,
  });
  const installed = join(repo, 'create-adr-md');
  cpSync(packagePath, installed, { recursive: true });
  for (const folder of ['.github', '.githooks']) {
    cpSync(join(source, folder), join(repo, folder), { recursive: true });
  }
  const config = join(repo, '.github/scripts/audit-adr.mjs');
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

function auditResult(result, missing, invalid) {
  status(result, 0);
  assert.ok(result.stdout.includes(`${missing} without ADR, ${invalid} invalid ADR(s)`), result.stdout);
  assert.ok(result.summary.includes(`Missing ADR **${missing}**`), result.summary);
  assert.ok(result.summary.includes(`Invalid ADR **${invalid}**`), result.summary);
  const lines = result.stdout.split('\n');
  assert.equal(lines.filter(line => line.startsWith('::warning title=ADR missing::')).length, missing);
  assert.equal(lines.filter(line => line.startsWith('::warning title=Invalid ADR::')).length, invalid);
}

for (const objectFormat of ['sha1', 'sha256']) {
  for (const recordType of ['Agent-Session', 'Retrospective']) {
    test(`${objectFormat} accepts a regular ${recordType} ADR`, t => {
      const repo = fixture(t, objectFormat);
      repo.write(adrPath, document([repo.implementation], { recordType }));
      repo.commit();
      status(repo.validate(), 0);
      status(repo.hook(), 0);
      auditResult(repo.audit(), 0, 0);
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
      auditResult(repo.audit(), 1, 1);
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
    auditResult(repo.audit(), 1, 1);
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
    auditResult(repo.audit(), 0, 1);
  });
}

test('a later valid reference preserves earlier coverage', t => {
  const repo = fixture(t);
  auditResult(repo.audit(), 1, 0);
  repo.write(adrPath, document([repo.implementation]));
  repo.commit();
  auditResult(repo.audit(), 0, 0);
  const later = repo.code();
  auditResult(repo.audit(), 1, 0);
  repo.write(adrPath, document([repo.implementation, later]));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(later), 0);
  const result = repo.audit();
  auditResult(result, 0, 0);
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
  auditResult(repo.audit(), 0, 0);
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
  auditResult(repo.audit(), 1, 1);
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
  auditResult(repo.audit(), 1, 1);
});

for (const length of [120, 121]) {
  test(`accepts a ${length}-character title for manual style review`, t => {
    const repo = fixture(t);
    repo.write(adrPath, document([repo.implementation], { title: 'A'.repeat(length) }));
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0, 0);
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
    auditResult(repo.audit(), 0, 0);
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
    auditResult(repo.audit(), 0, 0);
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
    auditResult(repo.audit(), 1, 1);
  });
}

test('the installation guide example works with a real local push', t => {
  const repo = fixture(t);
  const guide = readFileSync(join(packagePath, 'about.txt'), 'utf8');
  const example = guide.match(/```markdown\n([\s\S]*?)\n```/);
  assert.ok(example, 'Installation guide contains a complete ADR example');
  const path = 'docs/adr/0042-cache-sync.md';
  repo.write(path, example[1].replace('OWNER/REPO', 'example/adr-tests')
    .replace('0123456789abcdef0123456789abcdef01234567', repo.implementation) + '\n');
  repo.commit();
  status(repo.validate(path), 0);
  const remote = join(repo.directory, 'remote.git');
  repo.git('init', '-q', '--bare', remote);
  repo.git('remote', 'set-url', '--push', 'origin', remote);
  status(repo.run('git', ['push', '-q', 'origin', 'main']), 0);
  auditResult(repo.audit(), 0, 0);
  repo.code();
  status(repo.run('git', ['push', '-q', 'origin', 'main']), 0);
  auditResult(repo.audit(), 1, 0);
});

for (const before of ['Context', 'Decision', 'Rationale', 'Alternatives', 'Consequences',
  'Implementation', 'Implementation Commit', null]) {
  test(`accepts Related Symbols ${before ? `before ${before}` : 'at the end'} through all entry points`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation], undefined, before));
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0, 0);
  });
}

test('accepts an empty Related Symbols section', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation], ''));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0, 0);
});

test('accepts symbol kinds, Markdown lists, and descriptions', t => {
  const repo = fixture(t);
  const path = 'src/[pressure]/Pressure Service.ts';
  repo.write(path, 'export interface Calculator { calculate(): number; }\n' +
    'export class PressureService { flowRate = 0; calculate() { return this.flowRate; } }\n' +
    'export function validatePressure() {}\nexport let pressure = 0;\nexport let Pressure = 0;\n' +
    'export const MAX_PRESSURE = 10;\n');
  const implementation = repo.commit();
  const symbols = ['Calculator', 'PressureService', 'PressureService.flowRate',
    'PressureService.calculate', 'validatePressure', 'pressure', 'Pressure', 'MAX_PRESSURE'];
  const markers = ['-', '*', '+', '1.', '2)'];
  const body = symbols.map((name, index) =>
    `${markers[index % markers.length]} \`${path}#${name}\` — verified symbol.\n   Used by the decision.`).join('\n\n');
  repo.write(adrPath, relatedDocument([repo.implementation, implementation], body));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0, 0);
});

for (const marker of ['```', '~~~~']) {
  test(`ignores fenced examples (${marker}) and prose mentions as exact links`, t => {
    const repo = fixture(t);
    const body = '- `src/cache.mjs#cache`\n\n' +
      `${marker}markdown\n## Related Symbols\n- \`missing.ts#Missing\`\n${marker}\n`;
    const text = relatedDocument([repo.implementation], body).replace('Not recorded.',
      `Call \`cache.get()\` and read \`missingSymbol\`.\n\n${marker}markdown\n` +
      '## Related Symbols\n- `missing.ts#Missing`\n## Implementation Commit\n' +
      '- https://github.com/example/adr-tests/commit/ffffffffffffffffffffffffffffffffffffffff\n' +
      `### Example heading\n${marker}\n`);
    repo.write(adrPath, text);
    repo.commit();
    status(repo.validate(), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0, 0);
  });
}

for (const identifier of [
  'src/cache.mjs:cache', '#cache', 'src/cache.mjs#', 'src/cache.mjs#cache#extra',
  'src/cache.mjs#cache()', 'src/cache.mjs#cache value', 'src\\cache.mjs#cache',
  '/src/cache.mjs#cache', 'C:/src/cache.mjs#cache', '../src/cache.mjs#cache',
  './src/cache.mjs#cache', 'src//cache.mjs#cache', 'src/cache.mjs:12#cache',
  'src/cache.mjs#cache:12',
]) {
  test(`rejects malformed related symbol ${identifier}`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation], `- \`${identifier}\``));
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, /Invalid related symbol identifier/);
  });
}

for (const [name, body, error] of [
  ['missing backticks', '- src/cache.mjs#cache', /Each Related Symbols entry/],
  ['unlisted entry', '`src/cache.mjs#cache`', /Each Related Symbols entry/],
  ['two identifiers in one item', '- `src/cache.mjs#cache` and `src/cache.mjs#other`', /Each Related Symbols entry/],
  ['identifier in a description', '- `src/cache.mjs#cache`\n  `src/cache.mjs#other`', /Each Related Symbols entry/],
  ['duplicate reference', '- `src/cache.mjs#cache`\n- `src/cache.mjs#cache` — repeated.', /Duplicate related symbol/],
  ['missing file', '- `src/missing.mjs#cache`', /Source file does not exist with exact case/],
  ['wrong filename case', '- `src/Cache.mjs#cache`', /Source file does not exist with exact case/],
  ['wrong directory case', '- `Src/cache.mjs#cache`', /Source file does not exist with exact case/],
  ['directory', '- `src#cache`', /Source file does not exist with exact case/],
]) {
  test(`rejects ${name} in Related Symbols through all entry points`, t => {
    const repo = fixture(t);
    repo.write(adrPath, relatedDocument([repo.implementation], body));
    repo.commit();
    const result = repo.validate();
    status(result, 1);
    assert.match(result.stderr, error);
    status(repo.hook(), 1);
    auditResult(repo.audit(), 1, 1);
  });
}

test('rejects repeated Related Symbols sections', t => {
  const repo = fixture(t);
  repo.write(adrPath, relatedDocument([repo.implementation]) + '\n## Related Symbols\n');
  repo.commit();
  status(repo.validate(), 1);
  status(repo.hook(), 1);
  auditResult(repo.audit(), 1, 1);
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`${objectFormat} checks source files at the requested revision`, t => {
    const repo = fixture(t, objectFormat);
    repo.write(adrPath, relatedDocument([repo.implementation]));
    repo.commit();
    rmSync(join(repo.repo, 'src/cache.mjs'));
    status(repo.validate(), 1);
    status(repo.validate(adrPath, ['--source-revision', repo.implementation]), 0);
    status(repo.hook(), 0);
    auditResult(repo.audit(), 0, 0);
    const result = repo.validate(adrPath, ['--source-revision', repo.base]);
    status(result, 1);
    assert.match(result.stderr, /Source file does not exist with exact case/);
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
  auditResult(repo.audit(), 2, 1);
});

test('multiple ADRs can reference the same symbol', t => {
  const repo = fixture(t);
  const text = relatedDocument([repo.implementation]);
  repo.write(adrPath, text);
  repo.write('docs/adr/0002-other-cache.md', text.replace('ADR-0001:', 'ADR-0002:'));
  repo.commit();
  status(repo.validate(), 0);
  status(repo.hook(), 0);
  auditResult(repo.audit(), 0, 0);
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
