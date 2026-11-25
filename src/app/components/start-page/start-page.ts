import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

import { fileName } from '../../../lib/sources';
import { EditorStore } from '../../services/editor-store';
import { host } from '../../services/host';
import { NEW_FORMATS } from '../../shared/new-formats';

/**
 * What the main area shows when nothing is open: what the editor opens, Open… and New buttons, and the recent
 * projects (the same list as File → Open Recent Project), a click opening one.
 */
@Component({
  selector: 'app-start-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start-page.html',
  styleUrl: './start-page.css',
})
export class StartPage {
  readonly store = inject(EditorStore);
  readonly newFormats = NEW_FORMATS;
  readonly fileName = fileName;
  /** The recent projects, the latest first, kept up to date as the main process changes the list. */
  readonly recentProjects = signal<string[]>([]);

  constructor() {
    void host.getRecentProjects().then((paths) => this.recentProjects.set(paths));
    const stop = host.onRecentProjects((paths) => this.recentProjects.set(paths));
    inject(DestroyRef).onDestroy(stop);
  }

  /** The folder a project is in, shown under its name. */
  folderOf(path: string): string {
    return path.replace(/[\\/][^\\/]*$/, '');
  }
}
