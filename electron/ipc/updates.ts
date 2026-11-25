// IPC: updates (updates/updater.ts). The renderer reads and changes the two update settings (Settings in the sidebar),
// gets where an update stands when it loads (later changes come as `updates:status` messages), installs a downloaded
// update once it has asked about unsaved changes, and opens a release page.
import { ipcMain } from 'electron';
import { settingsFilePath } from '../settings/settings-file';
import { getUpdateSettings, setUpdateSettings } from '../settings/user-settings';
import type { UpdateSettings } from '../types';
import { installUpdate, openReleasePage, updateSettingsChanged, updateStatus } from '../updates/updater';

/** Registers the `updates:*` handlers. */
export function registerUpdateHandlers(): void {
  /** The update settings: check automatically, include pre-releases. */
  ipcMain.handle('updates:get-settings', () => getUpdateSettings(settingsFilePath()));

  /** Changes the update settings; they count from the next check. Returns them as they are now. */
  ipcMain.handle('updates:set-settings', (_e, change: Partial<UpdateSettings>) => {
    const before = getUpdateSettings(settingsFilePath());
    const after = setUpdateSettings(settingsFilePath(), change ?? {});
    updateSettingsChanged(before, after);
    return after;
  });

  /** Where an update stands now (undefined before a check has found anything). */
  ipcMain.handle('updates:get-status', () => updateStatus());

  /** Restart into the downloaded update. The renderer has asked about unsaved changes already. */
  ipcMain.on('updates:install', () => installUpdate());

  /** Opens a release page in the browser; only the project's pages on GitHub. */
  ipcMain.on('updates:open-release-page', (_e, url: unknown) => {
    if (typeof url === 'string') openReleasePage(url);
  });
}
