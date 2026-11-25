// Tests for source-patterns.ts (node --test, compiled to dist-electron/project/source-patterns.test.js; see
// scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expandPatterns, isPattern, patternBase, watchPatterns } from './source-patterns';

describe('source patterns', () => {
  const root = path.resolve('/work/temphire.server');

  it('expands patterns, relative ones from a folder, a folder and its subfolders with **', async () => {
    assert.equal(isPattern('dtos/*.ts'), true);
    assert.equal(isPattern('dtos/a.ts'), false);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-'));
    try {
      await fs.mkdir(path.join(dir, 'dtos', 'more', 'node_modules'), { recursive: true });
      for (const name of ['a.ts', 'b.cs', 'c.json', 'more/d.ts', 'more/node_modules/e.ts']) await fs.writeFile(path.join(dir, 'dtos', name), '');
      const [all, none] = await expandPatterns(['dtos/**/*.{ts,cs}', 'nowhere/*.ts'], dir);
      assert.equal(all.pattern, path.join(dir, 'dtos', '**', '*.{ts,cs}'));
      assert.deepEqual(all.files, ['a.ts', 'b.cs', path.join('more', 'd.ts')].map((n) => path.join(dir, 'dtos', n)));
      assert.deepEqual(none.files, []);
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
    const changes: string[][] = [];
    let notify: (() => void) | undefined;
    const pattern = path.join(dtos, '*.ts');
    const stop = await watchPatterns([pattern], (matches) => { changes.push(matches[0].files); notify?.(); }, 100);
    const next = () => new Promise<void>((resolve, reject) => {
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
