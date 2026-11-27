import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChildren } from '@angular/core';

import type { ExpressionSite } from '../../../lib/completion';
import { type Json, type ModelEntry, type Path, isPlainObject } from '../../../lib/doc';
import { matchesWords, propertyText, searchWords } from '../../../lib/rule-search';
import { fileName } from '../../../lib/sources';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue } from '../../shared/ids-and-comments';
import { Combobox } from '../combobox/combobox';
import { ExpressionInput } from '../expression-input/expression-input';
import { InlineIssues } from '../inline-issues/inline-issues';
import { PropertyEditor } from '../property-editor/property-editor';
import { RuleList } from '../rule-list/rule-list';

/**
 * The main area when a model type is selected: one model type's entry in the active document (`<Model>` at the top
 * level of the metadata). It edits the model's name, `extends`, `condition` and `$comment`, its model-level rules
 * (`validators`) and its properties (a property editor each, plus a field to add one, with the properties the model
 * sources know as suggestions). Above the properties, "Find properties and rules…" narrows them to those whose name,
 * shorthands or rules have the words typed (see rule-search.ts); the model-level rules have a search of their own,
 * in their rule list. All edits go to the active document in the EditorStore.
 */
@Component({
  selector: 'app-model-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList, PropertyEditor, ExpressionInput, Combobox],
  templateUrl: './model-editor.html',
  styleUrl: './model-editor.css',
})
export class ModelEditor {
  readonly store = inject(EditorStore);
  /** The model type: its key at the top level of the document. */
  readonly name = input.required<string>();
  /** What's typed in the "property…" field, until it's added. */
  readonly newProperty = signal('');
  readonly commentValue = commentValue;
  /** What's typed in "Find properties and rules…". */
  readonly propertyFilter = signal('');
  private readonly propertyEditors = viewChildren(PropertyEditor);

  constructor() {
    // Another model type selected (the editor stays and gets the new name): start it without a search.
    effect(() => {
      this.name();
      untracked(() => this.propertyFilter.set(''));
    });
  }

  /** The model's entry, or an empty one while it isn't (or is no longer) in the document. */
  readonly entry = computed(() => (this.store.get([this.name()]) ?? {}) as ModelEntry);
  readonly comment = computed(() => commentText(this.entry().$comment));
  /** The properties that have an entry, in document order. */
  readonly propertyNames = computed(() => (isPlainObject(this.entry().properties) ? Object.keys(this.entry().properties!) : []));
  /** The words searched for in the properties; none while the search is empty. */
  readonly propertyWords = computed(() => searchWords(this.propertyFilter()));
  /** The properties that show: all of them, or those whose text (see propertyText()) has every word searched for. */
  readonly shownProperties = computed(() => {
    const words = this.propertyWords();
    if (!words.length) return this.propertyNames();
    const properties = this.entry().properties!;
    return this.propertyNames().filter((p) => matchesWords(propertyText(p, properties[p]), words));
  });
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
  /**
   * The choices for "property…": the sources' properties (with their types), then names the metadata already uses for
   * this type in other open maps or for the type it extends, which helps when there's no source for it. Not the ones
   * this map has rules for already.
   */
  readonly propertyOptions = computed(() => {
    const present = new Set(this.propertyNames());
    const options = this.availableProperties().map((p) => ({ value: p.name, detail: p.type }));
    const seen = new Set([...present, ...options.map((o) => o.value)]);
    const base = this.entry().extends;
    for (const doc of this.store.allDocs()) {
      for (const [type, note] of [[this.name(), 'other map'], [base, 'extends ' + base]] as const) {
        const entry = type ? doc[type] : undefined;
        const props = isPlainObject(entry) && isPlainObject(entry['properties']) ? Object.keys(entry['properties']) : [];
        for (const name of props) {
          if (seen.has(name)) continue;
          seen.add(name);
          options.push({ value: name, detail: note });
        }
      }
    }
    return options;
  });
  /** Why "property…" has nothing to offer. */
  readonly noPropertiesText = computed(
    () => `No other properties known for ${this.name()}. Add the file it's declared in as a source (Add source…, Add folder…) to pick from its properties; any name can be typed.`,
  );

  /** A path below the model, e.g. `at('validators')`. */
  at(...keys: (string | number)[]): Path {
    return [this.name(), ...keys];
  }

  /** Sets one of the model's keys; undefined removes it. */
  set(key: string, value: Json | undefined): void {
    this.store.update(this.at(key), value);
  }

  /**
   * Adds an empty entry for the typed property (unless it has one already) and clears the field. It clears the search
   * too, which would most likely hide the new property.
   */
  addProperty(): void {
    const name = this.newProperty().trim();
    if (!name) return;
    if (!this.propertyNames().includes(name)) this.store.update(this.at('properties', name), {});
    this.newProperty.set('');
    this.propertyFilter.set('');
  }

  /** Enter in the search: unfolds the first property that matches. */
  openFirstProperty(): void {
    const first = this.shownProperties()[0];
    if (this.propertyWords().length && first) this.propertyEditors().find((e) => e.name() === first)?.open.set(true);
  }

  /** Esc in the search: clears it; with nothing in it, leaves the field. */
  clearSearch(event: Event): void {
    if (this.propertyFilter()) {
      event.preventDefault();
      this.propertyFilter.set('');
    } else {
      (event.target as HTMLInputElement).blur();
    }
  }
}
