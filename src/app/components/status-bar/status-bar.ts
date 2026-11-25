import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { EditorStore } from '../../services/editor-store';

/**
 * The status bar along the bottom: the last thing the editor did on the left ("Saved …", "New: x.ts"), and totals on
 * the right: metadata maps, model types, types known from the sources, errors and warnings.
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
}
