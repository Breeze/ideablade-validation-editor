// Tests for recent-projects.ts (node --test, compiled to dist-electron/settings/recent-projects.test.js; see
// scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearLastProject, clearRecentProjects, getLastProject, getRecentProjects, setLastProject } from './recent-projects';
import { loadWindowState } from './window-bounds';

const screens = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

describe('the recent projects', () => {
  const file = path.join(os.tmpdir(), `vews-${process.pid}.json`);
  const save = (state: object) => fs.writeFileSync(file, JSON.stringify(state));

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
});
