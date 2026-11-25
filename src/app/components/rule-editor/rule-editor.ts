import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';

import { COMMON_SETTINGS, OPERATORS, type SettingInfo } from '../../../lib/catalog';
import { REGEX_FLAGS } from '../../../lib/check';
import type { ExpressionSite } from '../../../lib/completion';
import { type Json, type JsonObject, type Path, type ValidatorObject, isPlainObject } from '../../../lib/doc';
import { regexTestKey } from '../../../lib/regex';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue } from '../../shared/ids-and-comments';
import { Combobox } from '../combobox/combobox';
import { ExpressionInput } from '../expression-input/expression-input';
import { InlineIssues } from '../inline-issues/inline-issues';
import { RegexEditor } from '../regex-editor/regex-editor';
import { withKey } from './with-key';

/**
 * One rule in a rule list: a validator, written either as a bare name (`"required"`) or as an object with `name`,
 * `id`, `async`, `condition`, `propertyNames` (model-level rules), `context` settings and `$comment`. Closed, it's a
 * one-line summary; open, it edits all of that, with a field for each context setting the validator takes (the
 * catalog says which and of what kind: number, operator, expression, regular expression...). Edits go through the
 * store's `updateValidator`, which writes the rule as an object when it needs one and as a bare name again when only
 * the name is left. Moving and removing are left to the rule list, through the outputs.
 */
@Component({
  selector: 'app-rule-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, ExpressionInput, RegexEditor, Combobox],
  // The host classes colour the card's left border: accent while open, red while the rule has errors.
  host: { class: 'rule', '[class.open]': 'open()', '[class.has-error]': 'hasError()' },
  templateUrl: './rule-editor.html',
  styleUrl: './rule-editor.css',
})
export class RuleEditor {
  private readonly store = inject(EditorStore);
  /** Where the rule is in the document: an index in a `validators` array. */
  readonly path = input.required<Path>();
  /** The model type the rule belongs to; undefined for global rules. */
  readonly modelType = input<string>();
  /** Set for a property's rules; undefined for model-level and global rules. */
  readonly propertyName = input<string>();
  /** First in its list: Move up is disabled. */
  readonly first = input(false);
  /** Last in its list: Move down is disabled. */
  readonly last = input(false);
  /** Move up (-1) or down (1) was clicked; the rule list moves it. */
  readonly moved = output<number>();
  /** Remove was clicked; the rule list removes it. */
  readonly removed = output<void>();

  /** Whether the card is unfolded. */
  readonly open = signal(false);
  readonly operators = OPERATORS;
  readonly commentValue = commentValue;
  /** Why the "Other settings" text wasn't applied (it isn't a JSON object), until it's fixed. */
  readonly otherError = signal<string | undefined>(undefined);

  /** The rule as it is in the document: a name, or an object. */
  readonly raw = computed(() => this.store.get(this.path()) as string | ValidatorObject | undefined);
  /** The rule as an object, whichever way it's written, so the template has one shape to show. */
  readonly rule = computed<ValidatorObject>(() => {
    const raw = this.raw();
    return typeof raw === 'string' ? { name: raw } : isPlainObject(raw) ? (raw as ValidatorObject) : { name: '' };
  });
  /** Where issues about the name are: the rule itself when it's a bare name, else its `name`. */
  readonly namePath = computed(() => (typeof this.raw() === 'string' ? this.path() : this.at('name')));
  /** What the catalog knows about the validator: description, default message, settings. */
  readonly info = computed(() => this.store.validatorInfo(this.rule().name));
  readonly validatorNames = this.store.validatorNames;
  /** Whether the editor knows the validator; an unknown name is shown in red. */
  readonly known = computed(() => this.validatorNames().includes(this.rule().name));
  /** The rule's `context` settings, or none. */
  readonly context = computed<JsonObject>(() => (isPlainObject(this.rule().context) ? this.rule().context! : {}));
  readonly regexFlags = REGEX_FLAGS;

  /** Where this rule's expressions are, for code completion. */
  readonly conditionSite = computed<ExpressionSite>(() => ({
    kind: 'validatorCondition',
    modelType: this.modelType(),
    propertyName: this.propertyName(),
    contextKeys: Object.keys(this.context()),
  }));
  /** The same for an `expression` validator's expression, which also sees the value. */
  readonly expressionSite = computed<ExpressionSite>(() => ({ ...this.conditionSite(), kind: 'expression' }));

  /** Where this rule's values to try are kept, in the project file: see regexTestKey(). */
  readonly regexTestKey = computed(() => regexTestKey(this.modelType(), this.propertyName(), this.group(), this.rule().id));

  /** The `flags` setting of a pattern rule, as a string of flag letters. */
  readonly flags = computed(() => (typeof this.context()['flags'] === 'string' ? (this.context()['flags'] as string) : ''));
  /** Flags in the setting that the editor doesn't offer: shown as chips that can only be removed. */
  readonly otherFlags = computed(() => [...new Set(this.flags().split(''))].filter((f) => !REGEX_FLAGS.some((r) => r.flag === f)));
  /** A pattern written as /source/flags brings its own flags, which win over the `flags` setting. */
  readonly patternHasOwnFlags = computed(() => typeof this.context()['expression'] === 'string' && /^\/.*\/[a-z]*$/s.test(this.context()['expression'] as string));

  hasFlag(flag: string): boolean {
    return this.flags().includes(flag);
  }

  /** Adds or removes a flag letter; no flags left removes the setting. */
  toggleFlag(flag: string): void {
    const current = this.flags();
    const next = current.includes(flag) ? current.split(flag).join('') : current + flag;
    this.setContext('flags', next || undefined);
  }
  /** The context settings to show a field for: the validator's own, then those every validator takes. */
  readonly settings = computed<SettingInfo[]>(() => [...(this.info()?.settings ?? []), ...COMMON_SETTINGS]);
  /** Errors at or below the rule: the card's left border turns red, so it shows even while closed. */
  readonly hasError = computed(() => this.store.issuesAt(this.path()).some((i) => i.severity === 'error'));
  readonly comment = computed(() => commentText(this.rule().$comment));

  /** The group this rule is in, if any: the path is [..., groupIndex, 'validators', ruleIndex]. */
  readonly group = computed(() => {
    const p = this.path();
    if (p.length >= 3 && p[p.length - 2] === 'validators') {
      const parent = this.store.get(p.slice(0, -2));
      if (isPlainObject(parent) && typeof parent['group'] === 'string') return parent['group'];
    }
    return undefined;
  });

  /** As the library builds it: name[_group]_property, or name[_group][_id] at model level. */
  readonly errorKey = computed(() => {
    const r = this.rule();
    let key = r.name;
    if (this.group()) key += `_${this.group()}`;
    if (this.propertyName()) key += `_${this.propertyName()}`;
    else if (r.id) key += `_${r.id}`;
    return key;
  });

  /** The model's properties (from the model sources and the document), for propertyNames and property settings. */
  readonly knownProperties = computed(() => {
    const type = this.modelType();
    if (!type) return [];
    const names = new Set<string>(this.store.catalog().get(type)?.properties.filter((p) => !p.navigation).map((p) => p.name) ?? []);
    const entry = this.store.doc()[type];
    if (isPlainObject(entry) && isPlainObject(entry['properties'])) Object.keys(entry['properties']).forEach((n) => names.add(n));
    return [...names].sort();
  });
  /** A model-level rule's `propertyNames`: the properties its errors are about. */
  readonly propertyNames = computed(() => (Array.isArray(this.rule().propertyNames) ? this.rule().propertyNames! : []));
  /** The known properties not in `propertyNames` yet: what the "add a property…" field offers. */
  readonly unusedProperties = computed(() => this.knownProperties().filter((p) => !this.propertyNames().includes(p)));
  /** Names in `propertyNames` that aren't known properties: shown separately, marked, so they can be removed. */
  readonly unknownPropertyNames = computed(() => this.propertyNames().filter((p) => !this.knownProperties().includes(p)));

  /** The context settings that have no field of their own (a custom validator's), as JSON. */
  readonly otherText = computed(() => {
    const known = new Set(this.settings().map((s) => s.key));
    const other = Object.fromEntries(Object.entries(this.context()).filter(([k]) => !known.has(k)));
    return Object.keys(other).length ? JSON.stringify(other) : '';
  });

  /** The context settings in one line for the closed card (without the message, which would crowd out the rest). */
  summary(): string {
    return Object.entries(this.context())
      .filter(([k]) => k !== 'messageTemplate')
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
  }

  /** A path below the rule, e.g. `at('context', 'minValue')`. */
  at(...keys: (string | number)[]): Path {
    return [...this.path(), ...keys];
  }

  /** Sets one of the rule's keys (name, id, async, condition...); undefined removes it. */
  set(key: string, value: Json | undefined): void {
    const testKey = this.regexTestKey();
    this.store.updateValidator(this.path(), (v) => withKey(v, key, value) as ValidatorObject);
    // A model-level rule's id is part of its test values' key: keep them with the rule.
    if (key === 'id') {
      const next = this.regexTestKey();
      this.store.moveRegexTests((k) => (k === testKey ? next : undefined));
    }
  }

  /** Sets one context setting; undefined removes it. */
  setContext(key: string, value: Json | undefined): void {
    this.store.updateValidator(this.path(), (v) => withKey(v, 'context', withKey(isPlainObject(v.context) ? v.context : {}, key, value)) as ValidatorObject);
  }

  /** For the number inputs: an empty field removes the setting rather than storing 0. */
  setNumber(key: string, text: string): void {
    this.setContext(key, text.trim() === '' ? undefined : Number(text));
  }

  /** A bound is a number when it reads as one, otherwise a date or relative date string. */
  setBound(key: string, text: string): void {
    const t = text.trim();
    this.setContext(key, t === '' ? undefined : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t);
  }

  /** A list setting (validValues...) as text, one value per line. */
  valuesText(key: string): string {
    const values = this.context()[key];
    return Array.isArray(values) ? values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n') : '';
  }

  /** Sets a list setting from text, one value per line: numbers, true, false and null become JSON values, the rest strings. */
  setValues(key: string, text: string): void {
    const values = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .map((l) => (/^(-?\d+(\.\d+)?|true|false|null)$/.test(l) ? (JSON.parse(l) as Json) : l));
    this.setContext(key, values);
  }

  /**
   * Replaces the settings that have no field of their own with those in the JSON text, keeping the others. Text that
   * isn't a JSON object isn't applied; otherError says why.
   */
  setOther(text: string): void {
    let other: JsonObject = {};
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as Json;
        if (!isPlainObject(parsed)) throw new Error('Not a JSON object.');
        other = parsed;
      } catch (e) {
        this.otherError.set(`Other settings: ${(e as Error).message}`);
        return;
      }
    }
    this.otherError.set(undefined);
    const known = new Set(this.settings().map((s) => s.key));
    const kept = Object.fromEntries(Object.entries(this.context()).filter(([k]) => known.has(k)));
    this.store.updateValidator(this.path(), (v) => ({ ...v, context: { ...kept, ...other } }));
  }

  /** Adds a property to `propertyNames` or removes it; none left removes the key. */
  /** Enter in "add a property…" with a name typed that isn't in the list: added as it is. */
  addTypedProperty(text: string): void {
    const name = text.trim();
    if (name && !this.propertyNames().includes(name)) this.toggleProperty(name);
  }

  /** Adds a property to `propertyNames`, or takes it out. */
  toggleProperty(name: string): void {
    const list = this.propertyNames();
    const next = list.includes(name) ? list.filter((p) => p !== name) : [...list, name];
    this.set('propertyNames', next.length ? next : undefined);
  }
}
