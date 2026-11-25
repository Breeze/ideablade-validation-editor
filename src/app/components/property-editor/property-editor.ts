import { ChangeDetectionStrategy, Component, computed, inject, input, signal, effect, untracked } from '@angular/core';

import { type Json, type Path, type PropertyEntry, isPlainObject, renameKey } from '../../../lib/doc';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue } from '../../shared/ids-and-comments';
import { type ComboOption, Combobox } from '../combobox/combobox';
import { InlineIssues } from '../inline-issues/inline-issues';
import { RuleList } from '../rule-list/rule-list';

/**
 * One property of a model type (`<Model>.properties.<name>` in the metadata), as a card in the model editor's
 * Properties section. Closed, it's a one-line summary (the type from the model sources, the shorthands, the number of
 * rules and of issues); open, it edits the property's name, `displayName`, the `required`/`minLength`/`maxLength`
 * shorthands, `from`, `$comment` and its rules (`validators`, through a rule list). All edits go to the active
 * document in the EditorStore.
 */
@Component({
  selector: 'app-property-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList, Combobox],
  // The `open` class gives the open card its stronger border and background (see the CSS).
  host: { class: 'property', '[class.open]': 'open()' },
  templateUrl: './property-editor.html',
  styleUrl: './property-editor.css',
})
export class PropertyEditor {
  private readonly store = inject(EditorStore);
  /** The model type the property belongs to. */
  readonly modelType = input.required<string>();
  /** The property's name: its key in the model's `properties`. */
  readonly name = input.required<string>();
  /** Whether the card is unfolded. It starts closed, so a long list of properties stays easy to scan. */
  readonly open = signal(false);

  constructor() {
    // An issue clicked in the Issues tab that's in this card: open it, so the issue can be seen.
    effect(() => {
      if (this.store.revealsInside(this.path())) untracked(() => this.open.set(true));
    });
  }
  readonly commentValue = commentValue;

  /** Where the property is in the document. */
  readonly path = computed<Path>(() => [this.modelType(), 'properties', this.name()]);
  /** The property's entry, or an empty one while it isn't (or is no longer) in the document. */
  readonly entry = computed(() => (this.store.get(this.path()) ?? {}) as PropertyEntry);
  readonly comment = computed(() => commentText(this.entry().$comment));
  /** The property as the model sources describe it (type, nullable, maxLength), if they have it. */
  readonly source = computed(() => this.store.catalog().get(this.modelType())?.properties.find((p) => p.name === this.name()));
  /** "3 rules" for the closed card, or nothing when there are none. */
  readonly ruleCount = computed(() => {
    const n = Array.isArray(this.entry().validators) ? this.entry().validators!.length : 0;
    return n ? `${n} rule${n === 1 ? '' : 's'}` : '';
  });
  /** Errors at or below the property, so a closed card still shows that something inside it needs fixing. */
  readonly errorCount = computed(() => this.store.issuesAt(this.path()).filter((i) => i.severity === 'error').length);
  /** Warnings at or below the property, as for errorCount. */
  readonly warningCount = computed(() => this.store.issuesAt(this.path()).filter((i) => i.severity === 'warning').length);

  /**
   * The choices for `from`: first "Type" for each type that has a property of this name (the library takes that one),
   * then "Type.property" for every known property of every other type, the same name included, so that property
   * shows as being there and can be named explicitly. Each with its type where a source declares it, so a property of
   * another kind (a boolean for a string) stands out; the checks warn about one that's picked.
   */
  readonly fromOptions = computed<ComboOption[]>(() => {
    const sameName: ComboOption[] = [];
    const all: ComboOption[] = [];
    const doc = this.store.doc();
    for (const type of this.store.allModelTypes()) {
      if (type === this.modelType()) continue;
      const sourceProperties = this.store.catalog().get(type)?.properties.filter((p) => !p.navigation) ?? [];
      const types = new Map(sourceProperties.map((p) => [p.name, p.type]));
      const names = new Set<string>(types.keys());
      const entry = doc[type];
      if (isPlainObject(entry) && isPlainObject(entry['properties'])) Object.keys(entry['properties']).forEach((n) => names.add(n));
      if (names.has(this.name())) sameName.push({ value: type, detail: `= ${type}.${this.name()}` });
      for (const n of names) all.push({ value: `${type}.${n}`, detail: types.get(n) });
    }
    return [...sameName, ...all];
  });

  /** A path below the property, e.g. `at('validators')`. */
  at(...keys: (string | number)[]): Path {
    return [...this.path(), ...keys];
  }

  /** Sets one of the property's keys; undefined removes it. */
  set(key: string, value: Json | undefined): void {
    this.store.update(this.at(key), value);
  }

  /** For the number inputs: an empty field removes the key rather than storing 0. */
  setNumber(key: string, text: string): void {
    this.set(key, text.trim() === '' ? undefined : Number(text));
  }

  /**
   * Renames the property where it is (its place among the properties stays). Does nothing when the new name is empty
   * or already taken.
   */
  rename(to: string): void {
    to = to.trim();
    const propertiesPath: Path = [this.modelType(), 'properties'];
    const properties = this.store.get(propertiesPath);
    if (!to || !isPlainObject(properties) || properties[to] !== undefined) return;
    this.store.update(propertiesPath, renameKey(properties, this.name(), to));
    // Its pattern rules' test values are keyed 'Model.property[@group]': keep them with the property.
    const from = `${this.modelType()}.${this.name()}`;
    this.store.moveRegexTests((k) => (k === from || k.startsWith(from + '@') ? `${this.modelType()}.${to}${k.slice(from.length)}` : undefined));
  }

  /** Removes the property, with all its rules, from the model. */
  remove(): void {
    this.store.update(this.path(), undefined);
  }
}
