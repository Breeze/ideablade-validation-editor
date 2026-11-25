// Tests for project-file.ts, the *.ivproj file (node --test, compiled to dist-electron/project/project-file.test.js;
// see scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findProject, isProjectFile, parseProject, projectFileName, projectText, readProject, writeProject } from './project-file';

describe('the project file', () => {
  const root = path.resolve('/work/temphire.server');
  const projectPath = path.join(root, 'temphire.ivproj');

  it('resolves paths relative to the file, with defaults for what is left out', () => {
    const project = parseProject(projectPath, JSON.stringify({ sources: ['breeze.json', '../temphire.angular/client/src/app/x.ts'] }));
    assert.deepEqual(project.metadata, []);
    assert.deepEqual(project.sources, [path.join(root, 'breeze.json'), path.resolve(root, '../temphire.angular/client/src/app/x.ts')]);
    assert.deepEqual(project.otherValidators, []);
    assert.equal(project.camelCase, true);
  });

  it('rejects what is not a list of paths', () => {
    assert.throws(() => parseProject(projectPath, '{ "sources": "breeze.json" }'), /'sources' must be a list of paths/);
    assert.throws(() => parseProject(projectPath, '[]'), /JSON object/);
  });

  it('writes relative paths with forward slashes, keeping keys it does not manage and the line endings', () => {
    const existing = '{\r\n  "$comment": "Ours.",\r\n  "owner": "team-a",\r\n  "sources": []\r\n}\r\n';
    const text = projectText(
      projectPath,
      {
        metadata: [path.join(root, 'TempHire.Server', 'Validation', 'validation.metadata.json')],
        sources: [path.resolve(root, '..', 'temphire.angular', 'client', 'x.ts')],
        otherValidators: ['loginAvailable'],
        camelCase: false,
      },
      existing,
    );
    assert.deepEqual(JSON.parse(text), {
      $comment: 'Ours.',
      owner: 'team-a',
      sources: ['../temphire.angular/client/x.ts'],
      metadata: ['TempHire.Server/Validation/validation.metadata.json'],
      otherValidators: ['loginAvailable'],
      camelCase: false,
    });
    assert.ok(text.includes('\r\n'));
  });

  it('keeps the values to try against pattern rules, sorted by rule, and leaves them out when there are none', () => {
    const tests = { 'Address.zipcode': { shouldPass: ['98101'], shouldFail: ['9810'] }, 'Address.city': { shouldPass: ['Seattle'], shouldFail: [] } };
    const base = { metadata: [], sources: [], otherValidators: [], camelCase: true };
    const text = projectText(projectPath, { ...base, regexTests: tests });
    assert.deepEqual(Object.keys(JSON.parse(text).regexTests), ['Address.city', 'Address.zipcode']);
    assert.deepEqual(parseProject(projectPath, text).regexTests, tests);
    assert.equal(JSON.parse(projectText(projectPath, { ...base, regexTests: {} }, text)).regexTests, undefined);
  });

  it('is found in the folder of a file or above it, and round-trips', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vep-'));
    try {
      const nested = path.join(dir, 'a', 'b');
      await fs.mkdir(nested, { recursive: true });
      assert.equal(await findProject(path.join(nested, 'm.json')), undefined);
      const file = path.join(dir, 'temphire.ivproj');
      const written = await writeProject(file, { metadata: [path.join(nested, 'm.json')], sources: [], otherValidators: [], camelCase: true });
      assert.equal(await findProject(path.join(nested, 'm.json')), file);
      assert.deepEqual(written.metadata, [path.join(nested, 'm.json')]);
      assert.match(await fs.readFile(file, 'utf8'), /"a\/b\/m\.json"/);

      // Patterns: expanded when read, each with its files, and written back as given, relative.
      for (const name of ['x.ts', 'y.ts', 'z.cs']) await fs.writeFile(path.join(nested, name), '');
      await fs.writeFile(file, JSON.stringify({ sources: ['a/b/*.ts', 'other.json'] }));
      const read = await readProject(file);
      assert.deepEqual(read.sourceFiles, [path.join(nested, 'x.ts'), path.join(nested, 'y.ts'), path.join(dir, 'other.json')]);
      assert.deepEqual(read.patterns, [{ pattern: path.join(nested, '*.ts'), files: [path.join(nested, 'x.ts'), path.join(nested, 'y.ts')] }]);
      const folder = path.join(dir, 'a', '**', '*.{ts,cs}');
      const saved = await writeProject(file, { metadata: [], sources: [folder, path.join(dir, 'other.json')], otherValidators: [], camelCase: true });
      assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).sources, ['a/**/*.{ts,cs}', 'other.json']);
      assert.deepEqual(saved.patterns[0].files, ['x.ts', 'y.ts', 'z.cs'].map((n) => path.join(nested, n)));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('is any *.ivproj, the first by name in the nearest folder that has one', async () => {
    assert.equal(isProjectFile('C:/x/TempHire.IVPROJ'), true);
    assert.equal(isProjectFile('C:/x/validation-editor.json'), false);
    assert.equal(projectFileName('temphire.angular'), 'temphire.angular.ivproj');
    assert.equal(projectFileName('temphire.ivproj'), 'temphire.ivproj');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vef-'));
    try {
      const nested = path.join(dir, 'client');
      await fs.mkdir(nested);
      for (const name of ['zeta.ivproj', 'alpha.ivproj', 'notes.json']) await fs.writeFile(path.join(dir, name), '{}');
      assert.equal(await findProject(path.join(nested, 'm.ts')), path.join(dir, 'alpha.ivproj'));
      await fs.writeFile(path.join(nested, 'client.ivproj'), '{}');
      assert.equal(await findProject(path.join(nested, 'm.ts')), path.join(nested, 'client.ivproj'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

});
