// Tests for window-bounds.ts (node --test, compiled to dist-electron/settings/window-bounds.test.js; see
// scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_WINDOW_SIZE, isVisible, loadWindowState } from './window-bounds';

const screens = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

describe('the window bounds', () => {
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

  it('counts a window as visible when its title bar is on a screen', () => {
    assert.equal(isVisible({ x: -1500, y: 10, width: 1600, height: 900 }, screens), true); // 100 px showing
    assert.equal(isVisible({ x: 100, y: -500, width: 800, height: 600 }, screens), false); // title bar above the screen
  });
});
