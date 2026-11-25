import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { Path } from '../lib/doc';
import { EditorStore } from './editor-store';

/** The issues at a path (and, unless `exact`, below it), shown under the field or rule they're about. */
@Component({
  selector: 'app-inline-issues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (issue of issues(); track $index) {
      <div class="inline-issue" [class]="issue.severity">{{ issue.message }}</div>
    }
  `,
})
export class InlineIssues {
  private readonly store = inject(EditorStore);
  readonly path = input.required<Path>();
  readonly exact = input(false);
  readonly issues = computed(() => this.store.issuesAt(this.path(), this.exact()));
}

let nextId = 0;
/** Unique ids for `<datalist>`s. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}

/** `$comment` is a string, or an array of strings for one paragraph each: one paragraph per line in a textarea. */
export function commentText(comment: unknown): string {
  return Array.isArray(comment) ? comment.join('\n') : typeof comment === 'string' ? comment : '';
}

export function commentValue(text: string): string | string[] | undefined {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.length === 0 ? undefined : lines.length === 1 ? lines[0] : lines;
}
