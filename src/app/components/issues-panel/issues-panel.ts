import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { type DocIssue, EditorStore } from '../../services/editor-store';

/**
 * The Issues tab of the side pane: the issues of every open document (from the schema, the library and the model
 * sources), grouped by document when more than one has any. Clicking one selects what it's about and shows its line in
 * the JSON view (`EditorStore.focusIssue`). It doesn't edit anything.
 */
@Component({
  selector: 'app-issues-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issues-panel.html',
  styleUrl: './issues-panel.css',
})
export class IssuesPanel {
  readonly store = inject(EditorStore);
  /** The open documents that have issues, in order, each with its issues. */
  readonly groups = computed(() =>
    this.store
      .documents()
      .map((d) => ({ id: d.id, label: d.label(), issues: this.store.allIssues().filter((i) => i.docId === d.id) }))
      .filter((g) => g.issues.length > 0),
  );

  /** The severity as one character, the same as in the property cards' badges. */
  icon(issue: DocIssue): string {
    return issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '!' : 'i';
  }

  /** The issue's path, e.g. "Customer › properties › name › validators › [0]", or "(document)" for the whole. */
  where(issue: DocIssue): string {
    return issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join(' › ') || '(document)';
  }
}
