import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { Path } from '../../../lib/doc';
import { EditorStore } from '../../services/editor-store';

/**
 * The issues (from the schema, the library and the model sources) at a path in the active document, and unless
 * `exact` also those below it, shown right under the field, rule or section they're about. Used throughout the
 * editors (document, model, property, rule): the Issues panel lists the same issues, but here they're next to what
 * needs fixing. It only reads `EditorStore.issuesAt`; it doesn't edit anything.
 */
@Component({
  selector: 'app-inline-issues',
  // Where its issues are, so a clicked issue can be found in the page (App.revealIssue).
  host: { '[attr.data-issue-path]': 'pathKey()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inline-issues.html',
  styleUrl: './inline-issues.css',
})
export class InlineIssues {
  private readonly store = inject(EditorStore);
  /** The path in the document (e.g. `['Customer', 'properties', 'name']`) whose issues to show. */
  readonly path = input.required<Path>();
  /** Only the issues at exactly this path, not those of anything below it (which show under their own fields). */
  readonly exact = input(false);
  readonly issues = computed(() => this.store.issuesAt(this.path(), this.exact()));
  /** The path as an attribute value. */
  readonly pathKey = computed(() => JSON.stringify(this.path()));
}
