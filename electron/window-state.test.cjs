// Tests for window-state.cjs (node --test).
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadWindowState,
  isVisible,
  getSelection,
  setSelection,
  getLastProject,
  setLastProject,
  clearLastProject,
  getRecentProjects,
  clearRecentProjects,
  DEFAULT_WINDOW_SIZE,
} = require('./window-state.cjs');

const screens = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

describe('the window state', () => {
  const file = path.join(os.tmpdir(), `vews-${process.pid}.json`);
  const save = (state) => fs.writeFileSync(file, JSON.stringify(state));

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
    setLastProject(file, projects[5].toUpperCase()); // the same file, written differently: moves up, not added
    assert.equal(getRecentProjects(file).length, 10);
    assert.equal(getRecentProjects(file)[0], projects[5].toUpperCase());
    fs.rmSync(projects[11]);
    assert.ok(!getRecentProjects(file).includes(projects[11]));
    clearRecentProjects(file);
    assert.deepEqual(getRecentProjects(file), []);
    assert.equal(getLastProject(file), projects[5].toUpperCase()); // still the one to reopen
    clearLastProject(file); // File → Close Project
    assert.equal(getLastProject(file), undefined);
    assert.ok('recentProjects' in JSON.parse(fs.readFileSync(file, 'utf8'))); // the rest of the file stays
    fs.rmSync(dir, { recursive: true });
    fs.rmSync(file, { force: true });
  });

  it('counts a window as visible when its title bar is on a screen', () => {
    assert.equal(isVisible({ x: -1500, y: 10, width: 1600, height: 900 }, screens), true); // 100 px showing
    assert.equal(isVisible({ x: 100, y: -500, width: 800, height: 600 }, screens), false); // title bar above the screen
  });
});
