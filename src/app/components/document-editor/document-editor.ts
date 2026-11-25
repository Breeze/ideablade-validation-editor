import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { schemaVersion } from '../../../generated/schema-validator';
import { DEFAULT_SCHEMA_URL, type Json } from '../../../lib/doc';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue } from '../../shared/ids-and-comments';
import { InlineIssues } from '../inline-issues/inline-issues';
import { RuleList } from '../rule-list/rule-list';
import { describeDocument } from './describe-document';

/**
 * The main area when a document (rather than one of its model types) is selected: the active document's own settings.
 * Shows where it's saved and why it may be read-only, and edits `$schema` (JSON files only: TS and C# maps don't have
 * one), `$comment` and the global rules (`global.validators`, applied to every model type), in the EditorStore.
 */
@Component({
  selector: 'app-document-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList],
  templateUrl: './document-editor.html',
  styleUrl: './document-editor.css',
})
export class DocumentEditor {
  readonly store = inject(EditorStore);
  /** The library version whose schema the editor checks against. */
  readonly schemaVersion = schemaVersion;
  readonly defaultSchema = DEFAULT_SCHEMA_URL;
  readonly commentValue = commentValue;
  /** The document's `$schema`, or '' when it has none. */
  readonly schema = computed(() => (typeof this.store.doc()['$schema'] === 'string' ? (this.store.doc()['$schema'] as string) : ''));
  readonly comment = computed(() => commentText(this.store.doc()['$comment']));
  /** Where and how the document is saved: see describeDocument(). */
  readonly where = computed(() => {
    const d = this.store.active();
    return d ? describeDocument(d.format(), d.path(), d.name()) : '';
  });

  /** Sets one of the document's top-level keys; undefined removes it. */
  set(key: string, value: Json | undefined): void {
    this.store.update([key], value);
  }
}
