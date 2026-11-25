// Tests for window-state.cjs (node --test).
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWindowState, isVisible, getSelection, setSelection, DEFAULT_WINDOW_SIZE } = require('./window-state.cjs');

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

  it('counts a window as visible when its title bar is on a screen', () => {
    assert.equal(isVisible({ x: -1500, y: 10, width: 1600, height: 900 }, screens), true); // 100 px showing
    assert.equal(isVisible({ x: 100, y: -500, width: 800, height: 600 }, screens), false); // title bar above the screen
  });
});
