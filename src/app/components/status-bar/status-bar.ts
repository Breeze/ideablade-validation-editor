import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import { Updates } from '../../services/updates';

/**
 * The status bar along the bottom: the last thing the editor did on the left ("Saved …", "New: x.ts"), and totals on
 * the right: metadata maps, model types, types known from the sources, errors and warnings. Before the totals, an
 * update's progress or what to do about it (Updates): "Downloading version X… 40%", then "Restart to update"; or, for
 * an install that can't update itself, "Download" (its release page). Nothing while there's no update, or a check
 * failed.
 *
 * It's an attribute component on the `<footer>` element.
 */
@Component({
  selector: 'footer[app-status-bar]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.css',
  host: { class: 'statusbar' },
})
export class StatusBar {
  readonly store = inject(EditorStore);
  readonly updates = inject(Updates);
}
