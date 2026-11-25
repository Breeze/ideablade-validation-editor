// Updates from the project's GitHub releases. How depends on how the editor was installed:
//
// - Windows (the NSIS installer) and Linux's AppImage update themselves, with electron-updater: it reads the
//   latest*.yml a release carries (the release workflow attaches them), downloads a newer installer in the background
//   and installs it when the user restarts from the status bar, or else when the app quits.
// - macOS (signed ad hoc only, and Squirrel.Mac won't install an unsigned update) and the .deb can't: there the check
//   reads GitHub's list of releases (releases.ts) and, if one is newer, the status bar links to its release page.
// - Running from source (`npm start`, `npm run dev`) never checks, unless IVE_UPDATE_FEED is set (below).
//
// Checks: one a few seconds after startup and then every 4 hours, while the setting "Check for updates automatically"
// is on (settings/user-settings.ts, getUpdateSettings); Help → Check for Updates… checks whatever the setting and
// always answers with a dialog, also when there's nothing new or the check failed. "Include pre-releases" decides
// whether alpha, beta and rc versions count. Where an update stands goes to the renderer as an UpdateStatus
// (`updates:status`), which the status bar shows; failed automatic checks are only logged.
//
// Testing: IVE_UPDATE_FEED=<url> makes the automatic updates use a generic feed at that URL instead of GitHub: a folder
// served over HTTP with the latest.yml (latest-linux.yml for an AppImage), the installer and its .blockmap that
// electron-builder writes. With it the checks run when running from source too (on Windows: a download, never an
// install, since there's no installed copy to update; Linux needs APPIMAGE set as well). On macOS, or a .deb, it only
// turns the GitHub check on when running from source. For example, after building a newer installer into a folder
// with `npx electron-builder --win nsis --publish never -c.extraMetadata.version=0.1.0-alpha.99
// -c.directories.output=<folder>` and serving that folder on port 8765:
//   IVE_UPDATE_FEED=http://localhost:8765 npx electron .
import { app, dialog, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { settingsFilePath } from '../settings/settings-file';
import { getUpdateSettings } from '../settings/user-settings';
import type { UpdateSettings, UpdateStatus } from '../types';
import { mainWindow, setCloseWithoutAsking } from '../window/main-window';
import { isReleasePageUrl, newestRelease, RELEASES_API } from './releases';

/** The first automatic check, this long after startup: the window is up and the project open by then. */
const FIRST_CHECK_DELAY = 5_000;
/** The automatic checks after that. */
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
/** electron-updater's errors that mean there's no release to update to, not that the check failed. */
const NOTHING_PUBLISHED = ['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'];

/** A generic update feed to use instead of GitHub, for testing (see above). */
const testFeed = process.env['IVE_UPDATE_FEED']?.trim() || undefined;

/**
 * How this copy gets updates: 'install' (electron-updater downloads and installs them), 'notify' (a link to the
 * release page), or 'off' (running from source, without a test feed).
 */
function updateMode(): 'install' | 'notify' | 'off' {
  if (!app.isPackaged && !testFeed) return 'off';
  if (process.platform === 'win32' && (testFeed || isNsisInstall())) return 'install';
  if (process.platform === 'linux' && process.env['APPIMAGE']) return 'install';
  return 'notify';
}

/**
 * True when the app runs from an NSIS install: its uninstaller is next to the exe. Not so for the unpacked build
 * (`npm run dist:dir`), which electron-updater would "update" by installing a copy elsewhere.
 */
function isNsisInstall(): boolean {
  return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
}

// ---- The status, for the status bar

/** Where an update stands; undefined until a check has found anything. */
let status: UpdateStatus | undefined;

/** The status now, for a renderer that has just loaded (it hears of changes through `updates:status`). */
export const updateStatus = (): UpdateStatus | undefined => status;

/**
 * Takes a new status and sends it to the renderer. A downloaded update stays ready to install: a later check that
 * finds nothing new or fails (offline, say) doesn't hide its Restart button.
 */
function setStatus(next: UpdateStatus): void {
  if (status?.state === 'ready' && (next.state === 'none' || next.state === 'error')) return;
  status = next;
  const win = mainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('updates:status', next);
}

// ---- Checking

let firstCheck: NodeJS.Timeout | undefined;
let interval: NodeJS.Timeout | undefined;

/**
 * Starts the automatic checks (once a few seconds from now, then every 4 hours) if this copy gets updates and the
 * setting is on; stops them if not. Called at startup and whenever the setting changes.
 */
export function scheduleUpdateChecks(): void {
  clearTimeout(firstCheck);
  clearInterval(interval);
  firstCheck = interval = undefined;
  if (updateMode() === 'off' || !getUpdateSettings(settingsFilePath()).checkAutomatically) return;
  firstCheck = setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY);
  interval = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL);
}

/** The update settings changed (Settings in the sidebar): turning automatic checks on or off (re)schedules them. */
export function updateSettingsChanged(before: UpdateSettings, after: UpdateSettings): void {
  if (before.checkAutomatically !== after.checkAutomatically) scheduleUpdateChecks();
}

/**
 * Checks for a newer version, the way this copy gets updates. `manual` (Help → Check for Updates…) answers with a
 * dialog whatever comes of it; an automatic check only updates the status, and logs a failure.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  const mode = updateMode();
  if (mode === 'off') {
    if (manual) await message('info', 'Updates are off when running from source.', 'Set IVE_UPDATE_FEED to try them with a local feed.');
    return;
  }
  const { includePrereleases } = getUpdateSettings(settingsFilePath());
  if (mode === 'install') await checkAndDownload(includePrereleases, manual);
  else await checkReleases(includePrereleases, manual);
}

/** The version electron-updater has downloaded, ready to install. */
let downloadedVersion: string | undefined;

/** electron-updater set up once: downloading on its own, never to an older version, and reporting to setStatus. */
let updaterSetUp = false;
function setUpUpdater(): void {
  if (updaterSetUp) return;
  updaterSetUp = true;
  autoUpdater.autoDownload = true;
  autoUpdater.disableWebInstaller = true; // the NSIS installer is the full one, not a web installer
  // Installed when the app quits if the user didn't restart for it; from source never (that would run the installer).
  autoUpdater.autoInstallOnAppQuit = app.isPackaged;
  if (testFeed) {
    if (!app.isPackaged) {
      // From source there's no app-update.yml, which says where downloads go: one of its own, in the user data folder,
      // keeps them apart from an installed copy's (ideablade-validation-editor-updater).
      const config = path.join(app.getPath('userData'), 'dev-app-update.yml');
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, `provider: generic\nurl: ${JSON.stringify(testFeed)}\nupdaterCacheDirName: ideablade-validation-editor-dev-updater\n`);
      autoUpdater.updateConfigPath = config;
      autoUpdater.forceDevUpdateConfig = true;
    }
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
  }
  let version: string | undefined; // the one being downloaded, for the progress
  autoUpdater.on('update-available', (info) => {
    version = info.version;
    // Found again by a later check: still ready (electron-updater takes it from its download folder).
    if (info.version !== downloadedVersion) setStatus({ state: 'available', version });
  });
  autoUpdater.on('download-progress', (progress) => setStatus({ state: 'downloading', version, percent: Math.floor(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    setStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('update-not-available', () => setStatus({ state: 'none', version: app.getVersion() }));
  autoUpdater.on('error', (e: Error) => {
    console.error('Update:', e.message);
    setStatus({ state: 'error', message: e.message });
  });
}

/** Asks the feed (GitHub's releases, or the test feed) for a newer version; electron-updater downloads it if so. */
async function checkAndDownload(includePrereleases: boolean, manual: boolean): Promise<void> {
  setUpUpdater();
  autoUpdater.allowPrerelease = includePrereleases;
  autoUpdater.allowDowngrade = false;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!manual) return;
    if (!result?.isUpdateAvailable) return await latestVersionMessage();
    const version = result.updateInfo.version;
    if (version === downloadedVersion) return await offerRestart(version);
    await message('info', `Version ${version} is available.`,
      'It is downloading now. Once it is ready, the status bar offers to restart for it; otherwise it is installed when you quit.');
  } catch (e) {
    // No release to update to (e.g. only pre-releases published, and they're left out): nothing new.
    if (NOTHING_PUBLISHED.includes((e as { code?: string }).code ?? '')) {
      setStatus({ state: 'none', version: app.getVersion() });
      if (manual) await latestVersionMessage();
    } else if (manual) {
      await message('error', "Couldn't check for updates.", (e as Error).message);
    }
  }
}

/** Reads GitHub's list of releases for a newer one; if there is, the status bar links to its page. */
async function checkReleases(includePrereleases: boolean, manual: boolean): Promise<void> {
  try {
    const response = await net.fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'IdeaBlade-Validation-Editor' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}`.trim());
    const found = newestRelease(await response.json(), app.getVersion(), includePrereleases);
    if (!found) {
      setStatus({ state: 'none', version: app.getVersion() });
      if (manual) await latestVersionMessage();
      return;
    }
    setStatus({ state: 'notify', version: found.version, url: found.url });
    if (!manual) return;
    const choice = await message('info', `Version ${found.version} is available.`,
      "This copy of the editor can't update itself: download the new version from its release page.", ['Download', 'Later']);
    if (choice === 0) openReleasePage(found.url);
  } catch (e) {
    console.error('Update check:', (e as Error).message);
    setStatus({ state: 'error', message: (e as Error).message });
    if (manual) await message('error', "Couldn't check for updates.", (e as Error).message);
  }
}

// ---- Installing, and the release pages

/**
 * Restarts into the downloaded update: the window closes without asking the renderer again (it asked about unsaved
 * changes before calling this), the installer runs without its pages and starts the new version. Does nothing
 * unless an update is ready, and never when running from source.
 */
export function installUpdate(): void {
  if (status?.state !== 'ready' || updateMode() !== 'install') return;
  if (!app.isPackaged) {
    void message('info', 'Not installing when running from source.', `Version ${status.version} was downloaded from the test feed, but there's no installed copy to update.`);
    return;
  }
  let failed = false;
  const onError = (): void => void (failed = true);
  autoUpdater.once('error', onError);
  setCloseWithoutAsking(true);
  autoUpdater.quitAndInstall(true, true); // silent, and run the new version afterwards
  autoUpdater.removeListener('error', onError);
  if (failed) setCloseWithoutAsking(false); // still open: closing asks again
}

/** Opens a release page (or the releases) in the browser: only the project's pages on GitHub, nothing else. */
export function openReleasePage(url: string): void {
  if (isReleasePageUrl(url)) void shell.openExternal(url);
}

// ---- Dialogs

/** A message box on the window, with OK or the given buttons; returns the index of the one clicked. */
async function message(type: 'info' | 'error', text: string, detail: string, buttons = ['OK']): Promise<number> {
  const options = { type, title: 'Updates', message: text, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 };
  const win = mainWindow();
  const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return result.response;
}

/** Nothing newer: says which version this is. */
async function latestVersionMessage(): Promise<void> {
  await message('info', `You have the latest version, ${app.getVersion()}.`, '');
}

/** A manual check found the update that's already downloaded: restart for it now? The renderer asks about unsaved changes. */
async function offerRestart(version: string): Promise<void> {
  const choice = await message('info', `Version ${version} is ready to install.`, 'Restart the editor to update.', ['Restart Now', 'Later']);
  if (choice === 0) mainWindow()?.webContents.send('menu', 'installUpdate');
}
