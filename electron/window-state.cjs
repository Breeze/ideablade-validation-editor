// The window's size, position and maximised state, kept between runs in the app's data folder (window-state.json).
// A saved position is used only if it's still on a connected screen; otherwise the window opens centred on the
// primary one, at the saved size if that fits.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT = { width: 1500, height: 950 };

/** The bounds to open with: the saved ones when they're still on a screen, else the default size. */
function loadWindowState(file, displays) {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ...DEFAULT };
  }
  const width = Number.isFinite(saved.width) && saved.width >= 400 ? saved.width : DEFAULT.width;
  const height = Number.isFinite(saved.height) && saved.height >= 300 ? saved.height : DEFAULT.height;
  const state = { width, height, maximized: saved.maximized === true };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && isVisible({ x: saved.x, y: saved.y, width, height }, displays)) {
    state.x = saved.x;
    state.y = saved.y;
  }
  return state;
}

/** True when enough of the window (its title bar at least) is on one of the screens' work areas. */
function isVisible(bounds, displays) {
  return displays.some(({ workArea: a }) => {
    const left = Math.max(bounds.x, a.x);
    const right = Math.min(bounds.x + bounds.width, a.x + a.width);
    const top = Math.max(bounds.y, a.y);
    const bottom = Math.min(bounds.y + 40, a.y + a.height); // the title bar
    return right - left >= 100 && bottom - top >= 20;
  });
}

/** The whole file, or {} when there's none yet or it doesn't read. */
function readFile(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  } catch {
    return {};
  }
}

/** Writes part of the file, keeping the rest: the window's bounds and the selections share it. */
function updateFile(file, change) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(change(readFile(file)), null, 2));
  } catch {
    // not worth failing over
  }
}

/** Saves the window's state now, and as it's moved, resized, maximised or closed. */
function trackWindowState(win, file) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized()) return;
    // The normal bounds, so a maximised window restores to the size it had before.
    const bounds = win.getNormalBounds();
    updateFile(file, (state) => ({ ...state, ...bounds, maximized: win.isMaximized() }));
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  for (const event of ['resize', 'move']) win.on(event, later);
  for (const event of ['maximize', 'unmaximize', 'close']) win.on(event, save);
}

// What was selected in the sidebar (a model, or a file's settings), per workspace: the project file, or the first
// metadata file when there's no project. A user setting, like the window's place, so it's kept here and not in the
// project file. The most recent 50 workspaces are kept.
const MAX_SELECTIONS = 50;

function getSelection(file, key) {
  const selections = readFile(file).selections;
  return selections && typeof selections === 'object' ? selections[key] : undefined;
}

function setSelection(file, key, selection) {
  updateFile(file, (state) => {
    const selections = { ...(state.selections && typeof state.selections === 'object' ? state.selections : {}) };
    delete selections[key]; // re-added last: the most recent at the end
    if (selection) selections[key] = selection;
    const keys = Object.keys(selections);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SELECTIONS))) delete selections[old];
    return { ...state, selections };
  });
}

// The project used last, reopened when the editor starts without files on its command line, and the ones before it,
// for File → Open Recent Project. User settings too.
const MAX_RECENT_PROJECTS = 10;

/** The last project's path, if there is one and its file is still there. */
function getLastProject(file) {
  const last = readFile(file).lastProject;
  return typeof last === 'string' && fs.existsSync(last) ? last : undefined;
}

/** The recent projects, the most recent first, without the ones that have been moved or deleted since. */
function getRecentProjects(file) {
  const recent = readFile(file).recentProjects;
  return Array.isArray(recent) ? recent.filter((p) => typeof p === 'string' && fs.existsSync(p)) : [];
}

/** Makes a project the last one, and the first of the recent ones (once: paths are compared ignoring case). */
function setLastProject(file, projectPath) {
  updateFile(file, (state) => {
    const before = Array.isArray(state.recentProjects) ? state.recentProjects : [];
    const others = before.filter((p) => typeof p === 'string' && p.toLowerCase() !== projectPath.toLowerCase());
    return { ...state, lastProject: projectPath, recentProjects: [projectPath, ...others].slice(0, MAX_RECENT_PROJECTS) };
  });
}

/** Empties the recent list. The last project is kept: it's still the one to reopen. */
function clearRecentProjects(file) {
  updateFile(file, (state) => ({ ...state, recentProjects: [] }));
}

module.exports = {
  loadWindowState,
  trackWindowState,
  isVisible,
  getSelection,
  setSelection,
  getLastProject,
  setLastProject,
  getRecentProjects,
  clearRecentProjects,
  DEFAULT_WINDOW_SIZE: DEFAULT,
};
