// Renders build/icon.svg (and build/icon-small.svg for 16-24 px) into build/icon.ico (the window, the exe and the installer), build/ivproj.ico (.ivproj files) and build/icon.png (512 px),
// with Electron's own Chromium, so no image library is needed. Run with `npm run icon` after changing the SVG.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
/** Up to this size, build/icon-small.svg. */
const SMALL = 24;
const buildDir = path.join(__dirname, '..', 'build');

/** An .ico with PNG images inside (Windows Vista and later read these at every size). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.whenReady().then(async () => {
  const full = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
  // The full drawing blurs at the smallest sizes: those use a bolder one.
  const small = fs.readFileSync(path.join(buildDir, 'icon-small.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><title>icon</title>');
  const render = (size, svg = size <= SMALL ? small : full) =>
    win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png').split(',')[1]);
      };
      img.onerror = () => reject(new Error('The SVG did not load'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    })`);
  const images = [];
  for (const size of SIZES) images.push({ size, png: Buffer.from(await render(size), 'base64') });
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico(images));
  // The .ivproj file type's icon on Windows: electron-builder's default name for it (an explicit `icon` there would
  // also be looked up as an .icns on macOS, where there's none).
  fs.writeFileSync(path.join(buildDir, 'ivproj.ico'), ico(images));
  fs.writeFileSync(path.join(buildDir, 'icon.png'), Buffer.from(await render(512), 'base64'));
  console.log(`build/icon.ico and build/ivproj.ico (${SIZES.join(', ')} px), build/icon.png (512 px)`);
  app.quit();
});
