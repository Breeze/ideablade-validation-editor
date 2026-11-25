import { Injectable, inject, signal } from '@angular/core';

import { EditorStore } from './editor-store';
import { host, type UpdateSettings, type UpdateStatus } from './host';

/**
 * Updates, as the renderer sees them. The main process (electron/updates/updater.ts) checks, downloads and installs;
 * this keeps where an update stands for the status bar, and the two update settings for the Settings panel (they live
 * in the main process's settings file, since it checks before the renderer is up).
 *
 * Installing restarts the app, so it asks about unsaved changes first, like closing the window does.
 */
@Injectable({ providedIn: 'root' })
export class Updates {
  private readonly store = inject(EditorStore);

  /** Where an update stands; undefined until a check has found anything. */
  readonly status = signal<UpdateStatus | undefined>(undefined);
  /** The update settings, at their defaults until the main process's arrive. */
  readonly settings = signal<UpdateSettings>({ checkAutomatically: true, includePrereleases: true });

  constructor() {
    host.onUpdateStatus((status) => this.status.set(status));
    // A check may have reported before this page loaded (or before a reload): the status as it is now, unless a
    // newer one has come in meanwhile.
    void host.getUpdateStatus().then((status) => {
      if (status && !this.status()) this.status.set(status);
    });
    void host.getUpdateSettings().then((settings) => this.settings.set(settings));
  }

  /** Changes an update setting; it counts from the next check, and turning automatic checks on schedules them. */
  async changeSettings(change: Partial<UpdateSettings>): Promise<void> {
    this.settings.set(await host.setUpdateSettings(change));
  }

  /** "Restart to update": asks about unsaved changes, then the main process closes the window and installs. */
  async install(): Promise<void> {
    if (await this.store.confirmDiscard()) host.installUpdate();
  }

  /** "Download", for an install that can't update itself: the new version's release page in the browser. */
  openReleasePage(): void {
    const url = this.status()?.url;
    if (url) host.openReleasePage(url);
  }
}
