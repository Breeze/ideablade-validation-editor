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

/** Saves the window's state now, and as it's moved, resized, maximised or closed. */
function trackWindowState(win, file) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized()) return;
    // The normal bounds, so a maximised window restores to the size it had before.
    const bounds = win.getNormalBounds();
    const state = { ...bounds, maximized: win.isMaximized() };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch {
      // not worth failing over
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  for (const event of ['resize', 'move']) win.on(event, later);
  for (const event of ['maximize', 'unmaximize', 'close']) win.on(event, save);
}

module.exports = { loadWindowState, trackWindowState, isVisible, DEFAULT_WINDOW_SIZE: DEFAULT };
