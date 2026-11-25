import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import { IssuesPanel } from '../issues-panel/issues-panel';
import { JsonView } from '../json-view/json-view';
import { TesterPanel } from '../tester-panel/tester-panel';

/** The right pane's tabs. */
type Pane = 'json' | 'issues' | 'test';

/**
 * The right-hand pane: tabs for the selected document's code (JSON, or the TS or C# file as it will be saved), the
 * issues the checks found (with their counts on the tab), and Try it, which validates a sample object.
 *
 * It's an attribute component on the `<aside>` element, a column of the shell's grid (see App).
 */
@Component({
  selector: 'aside[app-side-pane]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonView, IssuesPanel, TesterPanel],
  templateUrl: './side-pane.html',
  styleUrl: './side-pane.css',
  host: { class: 'side' },
})
export class SidePane {
  readonly store = inject(EditorStore);
  /** The tab showing. */
  readonly pane = signal<Pane>('json');
  /** The code tab is named after what the selected document is saved as. */
  readonly codeTabLabel = computed(() => ({ ts: 'TypeScript', cs: 'C#' })[this.store.active()?.format() as 'ts' | 'cs'] ?? 'JSON');

  constructor() {
    // Clicking an issue (in the Issues tab, or under a field) shows it in the code view.
    effect(() => {
      if (this.store.focusPath()) this.pane.set('json');
    });
  }
}
