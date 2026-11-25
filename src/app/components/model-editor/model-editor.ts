import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import type { ExpressionSite } from '../../../lib/completion';
import { type Json, type ModelEntry, type Path, isPlainObject } from '../../../lib/doc';
import { fileName } from '../../../lib/sources';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue, uniqueId } from '../../shared/ids-and-comments';
import { ExpressionInput } from '../expression-input/expression-input';
import { InlineIssues } from '../inline-issues/inline-issues';
import { PropertyEditor } from '../property-editor/property-editor';
import { RuleList } from '../rule-list/rule-list';

/**
 * The main area when a model type is selected: one model type's entry in the active document (`<Model>` at the top
 * level of the metadata). It edits the model's name, `extends`, `condition` and `$comment`, its model-level rules
 * (`validators`) and its properties (a property editor each, plus a field to add one, with the properties the model
 * sources know as suggestions). All edits go to the active document in the EditorStore.
 */
@Component({
  selector: 'app-model-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList, PropertyEditor, ExpressionInput],
  templateUrl: './model-editor.html',
  styleUrl: './model-editor.css',
})
export class ModelEditor {
  readonly store = inject(EditorStore);
  /** The model type: its key at the top level of the document. */
  readonly name = input.required<string>();
  /** What's typed in the "property…" field, until it's added. */
  readonly newProperty = signal('');
  readonly typesListId = uniqueId('types');
  readonly propsListId = uniqueId('props');
  readonly commentValue = commentValue;

  /** The model's entry, or an empty one while it isn't (or is no longer) in the document. */
  readonly entry = computed(() => (this.store.get([this.name()]) ?? {}) as ModelEntry);
  readonly comment = computed(() => commentText(this.entry().$comment));
  /** The properties that have an entry, in document order. */
  readonly propertyNames = computed(() => (isPlainObject(this.entry().properties) ? Object.keys(this.entry().properties!) : []));
  /** The model as the model sources describe it (kinds, files, properties), if they have it. */
  readonly catalogModel = computed(() => this.store.catalog().get(this.name()));
  /** The model source files the model is in, by file name. */
  readonly sourceNames = computed(() => this.catalogModel()?.sources.map(fileName).join(', ') ?? '');
  /** Suggestions for `extends`: every other model type. */
  readonly otherTypes = computed(() => this.store.allModelTypes().filter((t) => t !== this.name()));
  /** Where the condition is, for code completion: it sees the model, not a property value. */
  readonly conditionSite = computed<ExpressionSite>(() => ({ kind: 'modelCondition', modelType: this.name() }));
  /** The model sources' properties that have no entry yet (navigation properties can't have rules). */
  readonly availableProperties = computed(() => {
    const present = new Set(this.propertyNames());
    return (this.catalogModel()?.properties ?? []).filter((p) => !present.has(p.name) && !p.navigation);
  });

  /** A path below the model, e.g. `at('validators')`. */
  at(...keys: (string | number)[]): Path {
    return [this.name(), ...keys];
  }

  /** Sets one of the model's keys; undefined removes it. */
  set(key: string, value: Json | undefined): void {
    this.store.update(this.at(key), value);
  }

  /** Adds an empty entry for the typed property (unless it has one already) and clears the field. */
  addProperty(): void {
    const name = this.newProperty().trim();
    if (!name) return;
    if (!this.propertyNames().includes(name)) this.store.update(this.at('properties', name), {});
    this.newProperty.set('');
  }
}
