// Where the app's own files are at run time, worked out once, here. This file is compiled to dist-electron/paths.js,
// next to main.js and preload.js; the Angular app is in dist/ and the icons in build/, both one folder up from
// dist-electron/, in the source tree and in the packaged app (app.asar) alike. Code in subfolders (window/, ipc/)
// takes its paths from here rather than from its own __dirname.
import path from 'node:path';

/** The folder this file is compiled to: dist-electron/. */
const outDir = __dirname;

/** The preload script, compiled next to main.js (dist-electron/preload.js). */
export const preloadPath = path.join(outDir, 'preload.js');

/** The built Angular app's page (dist/index.html), loaded when there's no dev server. */
export const rendererIndexPath = path.join(outDir, '..', 'dist', 'index.html');

/**
 * The window's icon: Windows takes the .ico, with its small sizes; Linux a PNG. (macOS uses the app bundle's.) The
 * packaged exe has it built in; running from source (electron .) needs it, or Electron's own shows.
 */
export const windowIconPath = path.join(outDir, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
