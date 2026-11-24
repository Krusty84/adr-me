import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skill = fileURLToPath(new URL('../', import.meta.url));
const constraints = 'handbook/CONSTRAINTS.md';
const conventions = 'handbook/CONVENTIONS.md';
const link = n => `[src/cache keys.js:${n}](../src/cache%20keys.js#L${n})`;

function document(path) {
  const constraint = path === constraints;
  const type = constraint ? 'Constraint' : 'Convention';
  const id = constraint ? 'C-0042' : 'V-0017';
  const category = constraint ? 'State' : 'Naming';
  const title = constraint ? 'Cache availability' : 'Lookup keys';
  const gap = constraint ? 'C-0099' : 'V-0099';
  const proof = constraint
    ? `- **Change implications:** Reads fail before initialization.\n- **Evidence:** ${link(1)}\n- **Verification:** Inspect the guard.`
    : `- **Usage:** Name lookup keys consistently.\n\n| Example from an independent implementation | Evidence |\n| --- | --- |\n| \`firstKey\` | ${link(2)} |\n| \`otherKey\` | ${link(3)} |`;
  return `# ${basename(path, '.md')}: Cache

**Date:** 2024-02-29
**Record Type:** Retrospective
**Evidence:** Source code.

## Scope

The JavaScript cache in src/.

## ${type} index

| ID | Title | Category | Scope | Superseded by |
| --- | --- | --- | --- | --- |
| ${id} | ${title} | ${category} | src/ | — |
| ${gap} | One use | Other | src/ | — |

## ${type}s

### ${id} — ${title}

- **Category:** ${category}
- **Scope:** src/
- **Requirement:** ${constraint ? 'MUST' : 'SHOULD'}
- **Rule:** ${title} in the cache.
${proof}
- **Exceptions:** None found in the inspected scope.
- **Related:** ${constraint ? 'V-0017' : 'C-0042'}
- **Rationale:** Not recorded.
- **Owner:** Not recorded.
- **History:** First review pending.

## Observations

### ${gap} — One use

- **Category:** Other
- **Scope:** src/
- **Observation:** One cache guard.
- **Evidence:** ${link(1)}
- **Open question:** Inspect other callers.

## Known gaps and open questions

| ID | Uninspected area or conflicting rule IDs | Missing evidence | Owner | Next action |
| --- | --- | --- | --- | --- |
| GAP-001 | CLI | Startup order | Not recorded. | Inspect callers. |
`;
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), `${basename(skill)}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'target repo');
  const installed = join(dir, 'installed skill');
  for (const name of ['scripts', 'templates']) cpSync(join(skill, name), join(installed, name), { recursive: true });
  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  write('src/cache keys.js', 'if (!cache) throw Error();\nconst firstKey = 1;\nconst otherKey = 2;\n');
  write(constraints, document(constraints));
  write(conventions, document(conventions));
  const run = (...args) => spawnSync(process.execPath, [join(installed, 'scripts/validate-codebase-rules.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  const validate = (...paths) => run(...paths, '--repo', repo);
  return { repo, dir, write, run, validate };
}

function expect(result, code, pattern) {
  assert.ifError(result.error);
  assert.equal(result.status, code, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, pattern);
}

test('an installed validator checks each file and the pair at custom paths', t => {
  const f = fixture(t);
  expect(f.validate(constraints), 0, /PASS/);
  expect(f.validate(conventions), 0, /PASS/);
  expect(f.validate(conventions, constraints), 0, /PASS/);
  expect(f.run('--help'), 0, /Usage: node validate-codebase-rules\.mjs/);
  expect(f.run('--unknown'), 2, /option/i);
});

test('empty template sections and retained template comments are valid', t => {
  const f = fixture(t);
  const emptyHeadings = ['## Constraint index', '## Constraints', '## Observations', '## Known gaps and open questions'];
  const text = document(constraints).split(/(?=^## )/m).map(section => {
    const [heading] = section.split('\n', 1);
    return emptyHeadings.includes(heading) ? `${heading}\n\nNone recorded.\n\n` : section;
  }).join('').replace('## Scope', '<!-- Copy C-NNNN. -->\n## Scope');
  f.write(constraints, text);
  expect(f.validate(constraints), 0, /PASS/);
});

test('accepts ordinary Markdown links and literal code examples', t => {
  const f = fixture(t);
  const note = [
    'The API uses YYYY-MM-DD. See [Lifecycle](#Lifecycle).',
    '````md',
    '## Example heading',
    '[unverified:700](../missing#L700)',
    '```',
    '````',
    '<!--',
    '### C-9999 — Hidden heading',
    '-->',
  ].join('\n');
  const text = document(constraints)
    .replace('The JavaScript cache in src/.', note)
    .replace('| C-0042 | Cache availability |', '| [C-0042](#c-0042--cache-availability) | Cache availability |');
  f.write(constraints, text);
  expect(f.validate(constraints), 0, /PASS/);
});

test('invalid changes fail against the corresponding template', t => {
  const f = fixture(t);
  const cases = [
    [constraints, '2024-02-29', '2023-02-29', /date/i],
    [constraints, '## Observations', '## Unknown heading', /section/i],
    [constraints, '**Date:** 2024-02-29\n**Record Type:** Retrospective', '**Record Type:** Retrospective\n**Date:** 2024-02-29', /metadata/i],
    [constraints, '**Evidence:** Source code.', '**Evidence:** Source code.\n**Schema version:** 1.0', /metadata/i],
    [constraints, '### C-0042', '### V-0042', /ID|C-NNNN/i],
    [constraints, '### C-0099', '### C-0042', /duplicate/i],
    [constraints, '| State | src/ | — |', '| Other | src/ | — |', /index/i],
    [constraints, '| C-0042 | Cache availability', '| C-0043 | Cache availability', /index/i],
    [constraints, 'Requirement:** MUST', 'Requirement:** SHOULD', /requirement/i],
    [constraints, '- **Category:** Other', '- **Requirement:** MUST\n- **Category:** Other', /field|observation/i],
    [constraints, 'Category:** State', 'Category:** Unlisted', /category/i],
    [constraints, 'Related:** V-0017', 'Related:** V-17', /V-17/],
    [constraints, 'One cache guard.', '<Describe the behavior seen in the source.>', /placeholder/i],
    [constraints, '| GAP-001 | CLI', '| GAP-1 | CLI', /gap ID/i],
    [constraints, '- **Evidence:** ' + link(1), '- **Evidence:** Not recorded.', /evidence/i],
    [conventions, link(3), link(3).replace('#L3', '#L2'), /link|line/i],
    [conventions, link(3), link(9), /line/i],
    [conventions, link(3), link(3).replace('../src/', '../elsewhere/'), /link|path/i],
    [conventions, link(3), link(3).replaceAll('src/', 'SRC/'), /source path/i],
    [conventions, link(3), '[../outside.js:1](../../outside.js#L1)', /path/i],
    [conventions, `| \`otherKey\` | ${link(3)} |`, `| \`firstKey\` | ${link(2)} |`, /example/i],
    [conventions, '| Example from an independent implementation | Evidence |', '| Name | File |', /table|example/i],
  ];
  for (const [path, before, after, message] of cases) {
    const original = document(path);
    assert.ok(original.includes(before), before);
    f.write(path, original.replace(before, after));
    expect(f.validate(path), 1, message);
  }
});

test('rejects the legacy Technical review section in either document', t => {
  const f = fixture(t);
  for (const path of [constraints, conventions]) {
    f.write(path, document(path) + '\n## Technical review\n\n**Maintainers:** Cache team\n**Last reviewed:** Pending review.\n');
    expect(f.validate(path), 1, /sections/i);
  }
});

test('rejects legacy Status fields and index columns in either document', t => {
  const f = fixture(t);
  const cases = [
    ['**Date:**', '**Status:** Draft\n**Date:**', /metadata/i],
    ['- **Rule:**', '- **Status:** Pending review\n- **Rule:**', /fields/i],
    ['- **Category:** Other', '- **Status:** OBSERVED\n- **Category:** Other', /fields/i],
    ['| Scope | Superseded by |', '| Scope | Status | Superseded by |', /index.*columns/i],
  ];
  for (const path of [constraints, conventions]) {
    const original = document(path);
    for (const [before, after, message] of cases) {
      assert.ok(original.includes(before), before);
      f.write(path, original.replace(before, after));
      expect(f.validate(path), 1, message);
    }
  }
});

test('checks related IDs in the supplied documents and superseded entries', t => {
  const f = fixture(t);
  f.write(constraints, document(constraints).replace('Related:** V-0017', 'Related:** C-9999'));
  expect(f.validate(constraints), 1, /C-9999/);
  f.write(constraints, document(constraints).replace('Related:** V-0017', 'Related:** V-9999'));
  expect(f.validate(constraints), 0, /PASS/);
  expect(f.validate(constraints, conventions), 1, /V-9999/);
  f.write(constraints, document(constraints).replace('| State | src/ | — |', '| State | src/ | C-9999 |'));
  expect(f.validate(constraints), 1, /C-9999/);
});

test('rejects the unfilled templates and references through a symbolic link', t => {
  const f = fixture(t);
  for (const [path, template] of [[constraints, 'cons.md'], [conventions, 'conv.md']]) {
    f.write(path, readFileSync(join(skill, 'templates', template), 'utf8'));
    expect(f.validate(path), 1, /placeholder/i);
  }
  symlinkSync(join(f.repo, 'src/cache keys.js'), join(f.repo, 'src/alias.js'));
  f.write(conventions, document(conventions).replace(link(3), '[src/alias.js:3](../src/alias.js#L3)'));
  expect(f.validate(conventions), 1, /source|symbolic link/i);
});
