// Tests for project.cjs (node --test).
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findProject, isProjectFile, parseProject, patternBase, projectFileName, projectText, readProject, watchProjectFolders, writeProject } = require('./project.cjs');

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

      // Patterns: expanded when read, and kept when written back as long as they match a loaded file.
      for (const name of ['x.ts', 'y.ts', 'z.cs']) await fs.writeFile(path.join(nested, name), '');
      await fs.writeFile(file, JSON.stringify({ sources: ['a/b/*.ts', 'other.json'] }));
      const read = await readProject(file);
      assert.deepEqual(read.sourceFiles, [path.join(nested, 'x.ts'), path.join(nested, 'y.ts'), path.join(dir, 'other.json')]);
      const extra = path.join(nested, 'z.cs');
      const saved = await writeProject(file, { metadata: [], sources: [...read.sourceFiles.slice(0, 2), extra], otherValidators: [], camelCase: true });
      assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).sources, ['a/b/*.ts', 'a/b/z.cs']);
      assert.deepEqual(saved.sourceFiles, [path.join(nested, 'x.ts'), path.join(nested, 'y.ts'), extra]);
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

  it('knows where a pattern starts', () => {
    assert.deepEqual(patternBase(path.join(root, 'client', 'dtos', '*.ts')), { dir: path.join(root, 'client', 'dtos'), recursive: false });
    assert.deepEqual(patternBase(path.join(root, 'client', '**', '*.dto.ts')), { dir: path.join(root, 'client'), recursive: true });
  });

  it('notices files appearing in and disappearing from a pattern folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vew-'));
    const dtos = path.join(dir, 'dtos');
    await fs.mkdir(dtos);
    await fs.writeFile(path.join(dtos, 'a.ts'), '');
    const file = path.join(dir, 'temphire.ivproj');
    await fs.writeFile(file, JSON.stringify({ sources: ['dtos/*.ts'] }));
    const changes = [];
    let notify;
    const stop = await watchProjectFolders(file, (files) => { changes.push(files); notify?.(); }, 100);
    const next = () => new Promise((resolve, reject) => {
      notify = resolve;
      setTimeout(() => reject(new Error('no change reported')), 5000);
    });
    try {
      let change = next();
      await fs.writeFile(path.join(dtos, 'b.ts'), '');
      await fs.writeFile(path.join(dtos, 'notes.md'), ''); // not matched: no extra change
      await change;
      assert.deepEqual(changes.at(-1), [path.join(dtos, 'a.ts'), path.join(dtos, 'b.ts')]);
      change = next();
      await fs.rm(path.join(dtos, 'a.ts'));
      await change;
      assert.deepEqual(changes.at(-1), [path.join(dtos, 'b.ts')]);
      assert.equal(changes.length, 2);
    } finally {
      stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
