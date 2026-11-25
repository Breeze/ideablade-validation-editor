// Tests for user-settings.ts (node --test, compiled to dist-electron/settings/user-settings.test.js; see
// scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getFolds, getLastSaveFolder, getLayout, getSelection, setFolds, setLastSaveFolder, setLayout, setSelection } from './user-settings';
import { loadWindowState } from './window-bounds';

const screens = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

describe('the user settings', () => {
  const file = path.join(os.tmpdir(), `vews-${process.pid}.json`);
  const save = (state: object) => fs.writeFileSync(file, JSON.stringify(state));

  it('keeps a selection per workspace next to the window state, without one overwriting the other', () => {
    fs.rmSync(file, { force: true });
    save({ x: 10, y: 10, width: 1600, height: 1000, maximized: false });
    setSelection(file, 'C:/a/temphire.ivproj', { path: 'C:/a/x.json', kind: 'model', model: 'Address' });
    setSelection(file, 'C:/b/other.ivproj', { path: 'C:/b/y.ts', name: 'm', kind: 'document' });
    assert.deepEqual(getSelection(file, 'C:/a/temphire.ivproj'), { path: 'C:/a/x.json', kind: 'model', model: 'Address' });
    assert.equal(getSelection(file, 'C:/nowhere.ivproj'), undefined);
    assert.equal(loadWindowState(file, screens).width, 1600); // the bounds are still there
    for (let i = 0; i < 60; i++) setSelection(file, `k${i}`, { kind: 'document' });
    assert.equal(getSelection(file, 'C:/a/temphire.ivproj'), undefined); // the oldest go after 50
    assert.deepEqual(getSelection(file, 'k59'), { kind: 'document' });
    fs.rmSync(file, { force: true });
  });

  it('keeps the folded files and maps per workspace, next to the selection, and forgets a workspace with none', () => {
    fs.rmSync(file, { force: true });
    save({ x: 10, y: 10, width: 1600, height: 1000, maximized: false });
    assert.equal(getFolds(file, 'c:/a/temphire.ivproj'), undefined);
    setSelection(file, 'c:/a/temphire.ivproj', { kind: 'document' });
    setFolds(file, 'c:/a/temphire.ivproj', { files: ['c:\\a\\server.json'], maps: ['c:\\a\\client.ts#adminMetadata'] });
    setFolds(file, 'c:/b/other.ivproj', { files: ['c:\\b\\x.json'], maps: [] });
    assert.deepEqual(getFolds(file, 'c:/a/temphire.ivproj'), { files: ['c:\\a\\server.json'], maps: ['c:\\a\\client.ts#adminMetadata'] });
    assert.deepEqual(getFolds(file, 'c:/b/other.ivproj'), { files: ['c:\\b\\x.json'], maps: [] });
    assert.deepEqual(getSelection(file, 'c:/a/temphire.ivproj'), { kind: 'document' }); // the selection stays
    setFolds(file, 'c:/b/other.ivproj', { files: [], maps: [] }); // nothing folded: the entry goes
    assert.equal(getFolds(file, 'c:/b/other.ivproj'), undefined);
    assert.equal(loadWindowState(file, screens).width, 1600);
    fs.rmSync(file, { force: true });
  });

  it("keeps the panes' widths next to the window state, whole and positive only", () => {
    fs.rmSync(file, { force: true });
    assert.equal(getLayout(file), undefined);
    save({ x: 10, y: 10, width: 1600, height: 1000, maximized: false });
    setLayout(file, { sidebar: 360.4, side: 520 });
    assert.deepEqual(getLayout(file), { sidebar: 360, side: 520 });
    assert.equal(loadWindowState(file, screens).width, 1600); // the rest stays
    setLayout(file, { sidebar: -5 });
    assert.deepEqual(getLayout(file), { sidebar: undefined, side: undefined });
    fs.rmSync(file, { force: true });
  });

  it('remembers the folder last saved to, while it is still there', () => {
    fs.rmSync(file, { force: true });
    assert.equal(getLastSaveFolder(file), undefined);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vews-'));
    setLastSaveFolder(file, dir);
    assert.equal(getLastSaveFolder(file), dir);
    fs.rmSync(dir, { recursive: true });
    assert.equal(getLastSaveFolder(file), undefined); // gone: the project's folder is used instead
    fs.rmSync(file, { force: true });
  });

});
