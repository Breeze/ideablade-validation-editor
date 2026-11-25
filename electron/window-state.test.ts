// Tests for window-state.ts (node --test, compiled to dist-electron/window-state.test.js; see scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadWindowState,
  isVisible,
  getSelection,
  setSelection,
  getFolds,
  setFolds,
  getLastProject,
  setLastProject,
  clearLastProject,
  getRecentProjects,
  clearRecentProjects,
  getLastSaveFolder,
  setLastSaveFolder,
  getLayout,
  setLayout,
  DEFAULT_WINDOW_SIZE,
} from './window-state';

const screens = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

describe('the window state', () => {
  const file = path.join(os.tmpdir(), `vews-${process.pid}.json`);
  const save = (state: object) => fs.writeFileSync(file, JSON.stringify(state));

  it('opens at the saved size and position, maximised if it was', () => {
    save({ x: 2000, y: 100, width: 1600, height: 1000, maximized: true });
    assert.deepEqual(loadWindowState(file, screens), { x: 2000, y: 100, width: 1600, height: 1000, maximized: true });
  });

  it('keeps the size but not a position that is off every screen (a monitor unplugged)', () => {
    save({ x: 5000, y: 100, width: 1600, height: 1000 });
    assert.deepEqual(loadWindowState(file, screens), { width: 1600, height: 1000, maximized: false });
  });

  it('opens at the default size without a saved state, or with a broken one', () => {
    fs.rmSync(file, { force: true });
    assert.deepEqual(loadWindowState(file, screens), DEFAULT_WINDOW_SIZE);
    save({ width: 10, height: 'x' });
    assert.deepEqual(loadWindowState(file, screens), { ...DEFAULT_WINDOW_SIZE, maximized: false });
    fs.rmSync(file, { force: true });
  });

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

  it('remembers the last project, next to the window state, while its file is still there', () => {
    fs.rmSync(file, { force: true });
    assert.equal(getLastProject(file), undefined);
    save({ x: 10, y: 10, width: 1600, height: 1000, maximized: false });
    const project = path.join(os.tmpdir(), `vews-${process.pid}.ivproj`);
    fs.writeFileSync(project, '{}');
    setLastProject(file, project);
    assert.equal(getLastProject(file), project);
    assert.equal(loadWindowState(file, screens).width, 1600); // the bounds are still there
    fs.rmSync(project);
    assert.equal(getLastProject(file), undefined); // moved or deleted: nothing to reopen
    fs.rmSync(file, { force: true });
  });

  it('keeps the recent projects, the latest first, once each, at most 10, leaving out the ones that are gone', () => {
    fs.rmSync(file, { force: true });
    assert.deepEqual(getRecentProjects(file), []);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vews-'));
    const projects = Array.from({ length: 12 }, (_, i) => path.join(dir, `p${i}.ivproj`));
    for (const p of projects) fs.writeFileSync(p, '{}');
    for (const p of projects) setLastProject(file, p);
    assert.deepEqual(getRecentProjects(file), projects.slice(2).reverse()); // p11 … p2
    setLastProject(file, projects[4].split(path.sep).join('/')); // forward slashes: the same file, moves up
    assert.equal(getRecentProjects(file).length, 10);
    // In another case: the same file where names ignore case (Windows, macOS), another one on Linux.
    const sameFileOtherCase = process.platform === 'linux' ? projects[5] : projects[5].toUpperCase();
    setLastProject(file, sameFileOtherCase); // moves up, not added
    assert.equal(getRecentProjects(file).length, 10);
    assert.equal(getRecentProjects(file)[0], sameFileOtherCase);
    fs.rmSync(projects[11]);
    assert.ok(!getRecentProjects(file).includes(projects[11]));
    clearRecentProjects(file);
    assert.deepEqual(getRecentProjects(file), []);
    assert.equal(getLastProject(file), sameFileOtherCase); // still the one to reopen
    clearLastProject(file); // File → Close Project
    assert.equal(getLastProject(file), undefined);
    assert.ok('recentProjects' in JSON.parse(fs.readFileSync(file, 'utf8'))); // the rest of the file stays
    fs.rmSync(dir, { recursive: true });
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

  it('counts a window as visible when its title bar is on a screen', () => {
    assert.equal(isVisible({ x: -1500, y: 10, width: 1600, height: 900 }, screens), true); // 100 px showing
    assert.equal(isVisible({ x: 100, y: -500, width: 800, height: 600 }, screens), false); // title bar above the screen
  });
});
