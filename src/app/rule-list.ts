import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';

import { COMMON_SETTINGS, OPERATORS, type SettingInfo } from '../lib/catalog';
import { REGEX_FLAGS } from '../lib/check';
import type { ExpressionSite } from '../lib/completion';
import {
  type GroupEntry,
  type Json,
  type JsonObject,
  type Path,
  type RuleEntry,
  type ValidatorObject,
  isGroup,
  isPlainObject,
  moveItem,
} from '../lib/doc';
import { EditorStore } from './editor-store';
import { ExpressionInput } from './expression-input';
import { InlineIssues, commentText, commentValue, uniqueId } from './inline-issues';

/** Context settings that need something in them to be useful, so a new rule starts with them. */
function newRule(name: string): RuleEntry {
  switch (name) {
    case 'expression':
      return { name, context: { expression: '', messageTemplate: '' } };
    case 'pattern':
      return { name, context: { expression: '' } };
    case 'minLength':
    case 'maxLength':
      return { name, context: { [name]: 1 } };
    case 'range':
    case 'numericRange':
    case 'dateRange':
      return { name, context: { minValue: 0 } };
    case 'compare':
      return { name, context: { other: '', op: '==' } };
    case 'validValues':
    case 'invalidValues':
      return { name, context: { values: [] } };
    default:
      return name;
  }
}

/** One validator: a bare name or an object with id, condition, context settings and so on. */
@Component({
  selector: 'app-rule-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, ExpressionInput],
  host: { class: 'rule', '[class.open]': 'open()', '[class.has-error]': 'hasError()' },
  template: `
    <div class="rule-head" (click)="open.set(!open())">
      <span class="twisty">{{ open() ? '▾' : '▸' }}</span>
      <span class="rule-name" [class.unknown]="!known()">{{ rule().name || '(no name)' }}</span>
      @if (rule().id) { <span class="badge">id {{ rule().id }}</span> }
      @if (rule().async) { <span class="badge">async</span> }
      @if (rule().condition) { <span class="badge cond" [title]="rule().condition!">if …</span> }
      <span class="summary">{{ summary() }}</span>
      <span class="spacer"></span>
      <button class="icon" title="Move up" (click)="$event.stopPropagation(); moved.emit(-1)" [disabled]="first()">↑</button>
      <button class="icon" title="Move down" (click)="$event.stopPropagation(); moved.emit(1)" [disabled]="last()">↓</button>
      <button class="icon danger" title="Remove rule" (click)="$event.stopPropagation(); removed.emit()">✕</button>
    </div>
    @if (!open()) {
      <app-inline-issues [path]="path()" />
    } @else {
      <div class="rule-body">
        <label>Validator
          <input [attr.list]="listId" [value]="rule().name" (input)="set('name', $any($event.target).value)" />
          <datalist [id]="listId">
            @for (name of validatorNames(); track name) { <option [value]="name"></option> }
          </datalist>
          @if (info(); as info) {
            <small>{{ info.description }}@if (info.defaultMessage) { Default message: <code>{{ info.defaultMessage }}</code>}</small>
          }
        </label>
        <app-inline-issues [path]="namePath()" [exact]="true" />
        <div class="row">
          <label>Id <input [value]="rule().id ?? ''" placeholder="e.g. END_AFTER_START" (input)="set('id', $any($event.target).value || undefined)" /></label>
          <label class="check"><input type="checkbox" [checked]="!!rule().async" (change)="set('async', $any($event.target).checked || undefined)" /> async</label>
        </div>
        <div class="key-preview">Error key: <code>{{ errorKey() }}</code>@if (!propertyName() && !rule().id) { <small> (give model-level rules an id so their keys differ)</small> }</div>
        <div class="field">
          <span class="field-label">Condition <small>(the rule runs only when this is truthy)</small></span>
          <app-expression-input [value]="rule().condition ?? ''" [site]="conditionSite()" placeholder="e.g. model.country === 'US'"
            (changed)="set('condition', $event || undefined)" />
        </div>
        <app-inline-issues [path]="at('condition')" />

        @if (!propertyName() && modelType()) {
          <div class="field">
            <span class="field-label">Property names <small>(the properties this rule's errors are about)</small></span>
            <div class="chips">
              @for (p of knownProperties(); track p) {
                <label class="chip" [class.on]="propertyNames().includes(p)">
                  <input type="checkbox" [checked]="propertyNames().includes(p)" (change)="toggleProperty(p)" /> {{ p }}
                </label>
              }
              @for (p of unknownPropertyNames(); track p) {
                <label class="chip on unknown" title="Not a known property">
                  <input type="checkbox" checked (change)="toggleProperty(p)" /> {{ p }}
                </label>
              }
            </div>
            <app-inline-issues [path]="at('propertyNames')" />
          </div>
        }

        <fieldset>
          <legend>Context</legend>
          @for (s of settings(); track s.key) {
            <label [class.check]="s.kind === 'boolean'">
              @switch (s.kind) {
                @case ('boolean') {
                  <input type="checkbox" [checked]="!!context()[s.key]" (change)="setContext(s.key, $any($event.target).checked || undefined)" /> {{ s.label ?? s.key }}
                }
                @case ('integer') {
                  {{ s.label ?? s.key }}
                  <input type="number" min="0" step="1" [value]="context()[s.key] ?? ''" (change)="setNumber(s.key, $any($event.target).value)" />
                }
                @case ('bound') {
                  {{ s.label ?? s.key }}
                  <input [value]="context()[s.key] ?? ''" [placeholder]="s.help ?? ''" (change)="setBound(s.key, $any($event.target).value)" />
                }
                @case ('op') {
                  {{ s.label ?? s.key }}
                  <select (change)="setContext(s.key, $any($event.target).value || undefined)">
                    <option value="" [selected]="!context()[s.key]">(choose)</option>
                    @for (op of operators; track op) { <option [value]="op" [selected]="context()[s.key] === op">{{ op }}</option> }
                  </select>
                }
                @case ('property') {
                  {{ s.label ?? s.key }}
                  <input [attr.list]="propertyListId" [value]="context()[s.key] ?? ''" (input)="setContext(s.key, $any($event.target).value || undefined)" />
                }
                @case ('values') {
                  {{ s.label ?? s.key }} <small>(one per line)</small>
                  <textarea rows="3" [value]="valuesText(s.key)" (change)="setValues(s.key, $any($event.target).value)"></textarea>
                }
                @case ('expression') {
                  {{ s.label ?? s.key }} <small>(the value is valid when this is truthy)</small>
                  <app-expression-input [value]="$any(context()[s.key] ?? '')" [site]="expressionSite()" placeholder="e.g. model.endDate == null || model.endDate > model.startDate"
                    (changed)="setContext(s.key, $event)" />
                }
                @case ('flags') {
                  {{ s.label ?? s.key }}
                  <span class="chips">
                    @for (f of regexFlags; track f.flag) {
                      <span class="chip" role="checkbox" tabindex="0" [attr.aria-checked]="hasFlag(f.flag)" [class.on]="hasFlag(f.flag)" [title]="f.help"
                        (click)="$event.preventDefault(); toggleFlag(f.flag)" (keydown.space)="$event.preventDefault(); toggleFlag(f.flag)">
                        <code>{{ f.flag }}</code> {{ f.label }}
                      </span>
                    }
                    @for (f of otherFlags(); track f) {
                      <span class="chip on unknown" title="Not offered: see the warning" (click)="$event.preventDefault(); toggleFlag(f)"><code>{{ f }}</code> ✕</span>
                    }
                  </span>
                  @if (patternHasOwnFlags()) { <small>The pattern is written as /pattern/flags; its own flags apply.</small> }
                }
                @default {
                  {{ s.label ?? s.key }}
                  <input [class.code]="s.kind === 'regex'" [value]="context()[s.key] ?? ''" [placeholder]="s.help ?? ''" (input)="setContext(s.key, $any($event.target).value || undefined)" />
                }
              }
            </label>
            <app-inline-issues [path]="at('context', s.key)" />
          }
          <label>Other settings <small>(JSON object, for custom validators)</small>
            <textarea class="code" rows="1" [value]="otherText()" placeholder="{ }" (change)="setOther($any($event.target).value)"></textarea>
          </label>
          @if (otherError()) { <div class="inline-issue error">{{ otherError() }}</div> }
          <app-inline-issues [path]="at('context')" [exact]="true" />
        </fieldset>
        <datalist [id]="propertyListId">
          @for (p of knownProperties(); track p) { <option [value]="p"></option> }
        </datalist>
        <label>$comment
          <textarea class="comment" rows="1" [value]="comment()" placeholder="why this rule exists (one paragraph per line)" (change)="set('$comment', commentValue($any($event.target).value))"></textarea>
        </label>
        <app-inline-issues [path]="path()" [exact]="true" />
      </div>
    }
  `,
})
export class RuleEditor {
  private readonly store = inject(EditorStore);
  readonly path = input.required<Path>();
  readonly modelType = input<string>();
  readonly propertyName = input<string>();
  readonly first = input(false);
  readonly last = input(false);
  readonly moved = output<number>();
  readonly removed = output<void>();

  readonly open = signal(false);
  readonly listId = uniqueId('validator-names');
  readonly propertyListId = uniqueId('properties');
  readonly operators = OPERATORS;
  readonly commentValue = commentValue;
  readonly otherError = signal<string | undefined>(undefined);

  readonly raw = computed(() => this.store.get(this.path()) as string | ValidatorObject | undefined);
  readonly rule = computed<ValidatorObject>(() => {
    const raw = this.raw();
    return typeof raw === 'string' ? { name: raw } : isPlainObject(raw) ? (raw as ValidatorObject) : { name: '' };
  });
  readonly namePath = computed(() => (typeof this.raw() === 'string' ? this.path() : this.at('name')));
  readonly info = computed(() => this.store.validatorInfo(this.rule().name));
  readonly validatorNames = this.store.validatorNames;
  readonly known = computed(() => this.validatorNames().includes(this.rule().name));
  readonly context = computed<JsonObject>(() => (isPlainObject(this.rule().context) ? this.rule().context! : {}));
  readonly regexFlags = REGEX_FLAGS;

  /** Where this rule's expressions are, for code completion. */
  readonly conditionSite = computed<ExpressionSite>(() => ({
    kind: 'validatorCondition',
    modelType: this.modelType(),
    propertyName: this.propertyName(),
    contextKeys: Object.keys(this.context()),
  }));
  readonly expressionSite = computed<ExpressionSite>(() => ({ ...this.conditionSite(), kind: 'expression' }));

  readonly flags = computed(() => (typeof this.context()['flags'] === 'string' ? (this.context()['flags'] as string) : ''));
  readonly otherFlags = computed(() => [...new Set(this.flags().split(''))].filter((f) => !REGEX_FLAGS.some((r) => r.flag === f)));
  readonly patternHasOwnFlags = computed(() => typeof this.context()['expression'] === 'string' && /^\/.*\/[a-z]*$/s.test(this.context()['expression'] as string));

  hasFlag(flag: string): boolean {
    return this.flags().includes(flag);
  }

  toggleFlag(flag: string): void {
    const current = this.flags();
    const next = current.includes(flag) ? current.split(flag).join('') : current + flag;
    this.setContext('flags', next || undefined);
  }
  readonly settings = computed<SettingInfo[]>(() => [...(this.info()?.settings ?? []), ...COMMON_SETTINGS]);
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

  readonly knownProperties = computed(() => {
    const type = this.modelType();
    if (!type) return [];
    const names = new Set<string>(this.store.catalog().get(type)?.properties.filter((p) => !p.navigation).map((p) => p.name) ?? []);
    const entry = this.store.doc()[type];
    if (isPlainObject(entry) && isPlainObject(entry['properties'])) Object.keys(entry['properties']).forEach((n) => names.add(n));
    return [...names].sort();
  });
  readonly propertyNames = computed(() => (Array.isArray(this.rule().propertyNames) ? this.rule().propertyNames! : []));
  readonly unknownPropertyNames = computed(() => this.propertyNames().filter((p) => !this.knownProperties().includes(p)));

  readonly otherText = computed(() => {
    const known = new Set(this.settings().map((s) => s.key));
    const other = Object.fromEntries(Object.entries(this.context()).filter(([k]) => !known.has(k)));
    return Object.keys(other).length ? JSON.stringify(other) : '';
  });

  summary(): string {
    return Object.entries(this.context())
      .filter(([k]) => k !== 'messageTemplate')
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
  }

  at(...keys: (string | number)[]): Path {
    return [...this.path(), ...keys];
  }

  set(key: string, value: Json | undefined): void {
    this.store.updateValidator(this.path(), (v) => withKey(v, key, value) as ValidatorObject);
  }

  setContext(key: string, value: Json | undefined): void {
    this.store.updateValidator(this.path(), (v) => withKey(v, 'context', withKey(isPlainObject(v.context) ? v.context : {}, key, value)) as ValidatorObject);
  }

  setNumber(key: string, text: string): void {
    this.setContext(key, text.trim() === '' ? undefined : Number(text));
  }

  /** A bound is a number when it reads as one, otherwise a date or relative date string. */
  setBound(key: string, text: string): void {
    const t = text.trim();
    this.setContext(key, t === '' ? undefined : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t);
  }

  valuesText(key: string): string {
    const values = this.context()[key];
    return Array.isArray(values) ? values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n') : '';
  }

  setValues(key: string, text: string): void {
    const values = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .map((l) => (/^(-?\d+(\.\d+)?|true|false|null)$/.test(l) ? (JSON.parse(l) as Json) : l));
    this.setContext(key, values);
  }

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

  toggleProperty(name: string): void {
    const list = this.propertyNames();
    const next = list.includes(name) ? list.filter((p) => p !== name) : [...list, name];
    this.set('propertyNames', next.length ? next : undefined);
  }
}

/**
 * A list of rules: a model's or the global `validators`, a property's, or a group's. Groups contain a rule list of
 * their own (but no further groups).
 */
@Component({
  selector: 'app-rule-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleEditor],
  template: `
    <div class="rule-list">
      @for (rule of rules(); track $index; let i = $index) {
        @if (isGroup(rule)) {
          <div class="group">
            <div class="group-head">
              <span class="badge group-badge">group</span>
              <input class="group-name" [value]="rule.group" placeholder="group name" (input)="setGroupName(i, $any($event.target).value)" />
              <span class="spacer"></span>
              <button class="icon" title="Move up" (click)="move(i, -1)" [disabled]="i === 0">↑</button>
              <button class="icon" title="Move down" (click)="move(i, 1)" [disabled]="i === rules().length - 1">↓</button>
              <button class="icon danger" title="Remove group" (click)="remove(i)">✕</button>
            </div>
            <textarea class="comment" rows="1" placeholder="$comment" [value]="comment(rule)" (change)="setGroupComment(i, $any($event.target).value)"></textarea>
            <app-inline-issues [path]="at(i, 'group')" />
            <app-rule-list [path]="at(i, 'validators')" [modelType]="modelType()" [propertyName]="propertyName()" [inGroup]="true" />
          </div>
        } @else {
          <app-rule-editor [path]="at(i)" [modelType]="modelType()" [propertyName]="propertyName()"
            [first]="i === 0" [last]="i === rules().length - 1" (moved)="move(i, $event)" (removed)="remove(i)" />
        }
      } @empty {
        <div class="empty">No rules.</div>
      }
      <div class="add-row">
        <input [attr.list]="listId" placeholder="validator…" [value]="newName()" (input)="newName.set($any($event.target).value)" (keydown.enter)="add()" />
        <datalist [id]="listId">
          @for (name of validatorNames(); track name) {
            <option [value]="name"></option>
          }
        </datalist>
        <button (click)="add()" [disabled]="!newName().trim()">Add rule</button>
        @if (!inGroup()) {
          <button (click)="addGroup()">Add group</button>
        }
      </div>
    </div>
  `,
})
export class RuleList {
  private readonly store = inject(EditorStore);
  readonly path = input.required<Path>();
  readonly modelType = input<string>();
  /** Set for a property's rules; undefined for model-level and global rules. */
  readonly propertyName = input<string>();
  readonly inGroup = input(false);

  readonly listId = uniqueId('validators');
  readonly newName = signal('');
  readonly rules = computed(() => {
    const value = this.store.get(this.path());
    return (Array.isArray(value) ? value : []) as RuleEntry[];
  });
  readonly validatorNames = this.store.validatorNames;
  readonly isGroup = isGroup;
  readonly comment = (rule: GroupEntry) => commentText(rule.$comment);

  at(...keys: (string | number)[]): Path {
    return [...this.path(), ...keys];
  }

  add(): void {
    const name = this.newName().trim();
    if (!name) return;
    this.store.update(this.path(), [...this.rules(), newRule(name)] as Json);
    this.newName.set('');
  }

  addGroup(): void {
    this.store.update(this.path(), [...this.rules(), { group: 'submit', validators: [] }] as Json);
  }

  move(index: number, delta: number): void {
    this.store.update(this.path(), moveItem(this.rules(), index, index + delta) as Json);
  }

  remove(index: number): void {
    this.store.update(this.at(index), undefined);
  }

  setGroupName(index: number, name: string): void {
    this.store.update(this.at(index, 'group'), name);
  }

  setGroupComment(index: number, text: string): void {
    this.store.update(this.at(index, '$comment'), commentValue(text));
  }
}

function withKey<T extends object>(object: T, key: string, value: Json | undefined): T {
  const copy = { ...object } as Record<string, unknown>;
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy as T;
}

