import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { type Json, type ModelEntry, type Path, type PropertyEntry, isPlainObject, renameKey } from '../lib/doc';
import { fileName } from '../lib/sources';
import { EditorStore } from './editor-store';
import { InlineIssues, commentText, commentValue, uniqueId } from './inline-issues';
import { RuleList } from './rule-list';

/** One property entry: from, displayName, the shorthands, its rules. */
@Component({
  selector: 'app-property-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList],
  host: { class: 'property', '[class.open]': 'open()' },
  template: `
    <div class="property-head" (click)="open.set(!open())">
      <span class="twisty">{{ open() ? '▾' : '▸' }}</span>
      <span class="property-name">{{ name() }}</span>
      @if (source(); as s) { <span class="type" [title]="s.notes?.join(', ') ?? ''">{{ s.type }}{{ s.nullable ? '?' : '' }}</span> }
      @if (entry().from) { <span class="badge">from {{ entry().from }}</span> }
      @if (entry().required) { <span class="badge">required</span> }
      @if (entry().minLength != null) { <span class="badge">min {{ entry().minLength }}</span> }
      @if (entry().maxLength != null) { <span class="badge">max {{ entry().maxLength }}</span> }
      <span class="summary">{{ ruleCount() }}</span>
      @if (errorCount()) { <span class="badge error-badge">{{ errorCount() }} ✕</span> }
      @if (warningCount()) { <span class="badge warning-badge">{{ warningCount() }} !</span> }
      <span class="spacer"></span>
      <button class="icon danger" title="Remove property" (click)="$event.stopPropagation(); remove()">✕</button>
    </div>
    @if (!open()) {
      <app-inline-issues [path]="path()" [exact]="true" />
    } @else {
      <div class="property-body">
        <div class="row">
          <label>Name <input [value]="name()" (change)="rename($any($event.target).value)" /></label>
          <label>Display name <input [value]="entry().displayName ?? ''" placeholder="used as %displayName%" (input)="set('displayName', $any($event.target).value || undefined)" /></label>
        </div>
        <div class="row">
          <label class="check"><input type="checkbox" [checked]="!!entry().required" (change)="set('required', $any($event.target).checked || undefined)" /> required</label>
          <label>minLength <input type="number" min="0" [value]="entry().minLength ?? ''" (change)="setNumber('minLength', $any($event.target).value)" /></label>
          <label>maxLength <input type="number" min="0" [value]="entry().maxLength ?? ''" [placeholder]="source()?.maxLength != null ? 'source: ' + source()!.maxLength : ''" (change)="setNumber('maxLength', $any($event.target).value)" /></label>
        </div>
        <label>From <small>(inherit another model's property rules: Type, or Type.property)</small>
          <input [attr.list]="fromListId" [value]="entry().from ?? ''" (input)="set('from', $any($event.target).value || undefined)" />
          <datalist [id]="fromListId">
            @for (option of fromOptions(); track option) { <option [value]="option"></option> }
          </datalist>
        </label>
        <app-inline-issues [path]="at('from')" />
        <label>$comment
          <textarea class="comment" rows="1" [value]="comment()" (change)="set('$comment', commentValue($any($event.target).value))"></textarea>
        </label>
        <div class="section-title">Rules</div>
        <app-rule-list [path]="at('validators')" [modelType]="modelType()" [propertyName]="name()" />
        <app-inline-issues [path]="path()" [exact]="true" />
      </div>
    }
  `,
})
export class PropertyEditor {
  private readonly store = inject(EditorStore);
  readonly modelType = input.required<string>();
  readonly name = input.required<string>();
  readonly open = signal(false);
  readonly fromListId = uniqueId('from');
  readonly commentValue = commentValue;

  readonly path = computed<Path>(() => [this.modelType(), 'properties', this.name()]);
  readonly entry = computed(() => (this.store.get(this.path()) ?? {}) as PropertyEntry);
  readonly comment = computed(() => commentText(this.entry().$comment));
  readonly source = computed(() => this.store.catalog().get(this.modelType())?.properties.find((p) => p.name === this.name()));
  readonly ruleCount = computed(() => {
    const n = Array.isArray(this.entry().validators) ? this.entry().validators!.length : 0;
    return n ? `${n} rule${n === 1 ? '' : 's'}` : '';
  });
  readonly errorCount = computed(() => this.store.issuesAt(this.path()).filter((i) => i.severity === 'error').length);
  readonly warningCount = computed(() => this.store.issuesAt(this.path()).filter((i) => i.severity === 'warning').length);

  /** "Type" where Type has a property of this name, then "Type.property" for every other known property. */
  readonly fromOptions = computed(() => {
    const options: string[] = [];
    const others: string[] = [];
    const doc = this.store.doc();
    for (const type of this.store.allModelTypes()) {
      if (type === this.modelType()) continue;
      const names = new Set<string>(this.store.catalog().get(type)?.properties.filter((p) => !p.navigation).map((p) => p.name) ?? []);
      const entry = doc[type];
      if (isPlainObject(entry) && isPlainObject(entry['properties'])) Object.keys(entry['properties']).forEach((n) => names.add(n));
      if (names.has(this.name())) options.push(type);
      for (const n of names) if (n !== this.name()) others.push(`${type}.${n}`);
    }
    return [...options, ...others];
  });

  at(...keys: (string | number)[]): Path {
    return [...this.path(), ...keys];
  }

  set(key: string, value: Json | undefined): void {
    this.store.update(this.at(key), value);
  }

  setNumber(key: string, text: string): void {
    this.set(key, text.trim() === '' ? undefined : Number(text));
  }

  rename(to: string): void {
    to = to.trim();
    const propertiesPath: Path = [this.modelType(), 'properties'];
    const properties = this.store.get(propertiesPath);
    if (!to || !isPlainObject(properties) || properties[to] !== undefined) return;
    this.store.update(propertiesPath, renameKey(properties, this.name(), to));
  }

  remove(): void {
    this.store.update(this.path(), undefined);
  }
}

/** A model type: its settings, model-level rules and properties. */
@Component({
  selector: 'app-model-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList, PropertyEditor],
  template: `
    <div class="model-head">
      <input class="model-name" [value]="name()" (change)="store.renameModel(name(), $any($event.target).value)" title="Model type name" />
      @if (catalogModel(); as m) {
        <span class="badge source-badge" [title]="m.sources.join('\n')">{{ m.kinds.join(', ') }} · {{ sourceNames() }}</span>
      } @else if (store.sources().length) {
        <span class="badge muted" title="Not in any model source">no model source</span>
      }
      <span class="spacer"></span>
      <button class="danger" (click)="store.removeModel(name())">Remove model</button>
    </div>
    <app-inline-issues [path]="[name()]" [exact]="true" />

    <section>
      <div class="row">
        <label>Extends <small>(inherit all of another model's rules)</small>
          <input [attr.list]="typesListId" [value]="entry().extends ?? ''" (input)="set('extends', $any($event.target).value || undefined)" />
        </label>
        <datalist [id]="typesListId">
          @for (t of otherTypes(); track t) { <option [value]="t"></option> }
        </datalist>
      </div>
      <app-inline-issues [path]="at('extends')" />
      <label>Condition <small>(entity store validation skips models where this is falsy)</small>
        <textarea class="code" rows="1" [value]="entry().condition ?? ''" placeholder="e.g. !model.isTerminated" (input)="set('condition', $any($event.target).value || undefined)"></textarea>
      </label>
      <app-inline-issues [path]="at('condition')" />
      <label>$comment
        <textarea class="comment" rows="2" [value]="comment()" (change)="set('$comment', commentValue($any($event.target).value))"></textarea>
      </label>
    </section>

    <section>
      <div class="section-title">Model-level rules <small>(they get the whole model; propertyNames say which fields an error is about)</small></div>
      <app-rule-list [path]="at('validators')" [modelType]="name()" />
    </section>

    <section>
      <div class="section-title">Properties</div>
      @for (p of propertyNames(); track p) {
        <app-property-editor [modelType]="name()" [name]="p" />
      } @empty {
        <div class="empty">No properties with rules yet.</div>
      }
      <div class="add-row">
        <input [attr.list]="propsListId" placeholder="property…" [value]="newProperty()" (input)="newProperty.set($any($event.target).value)" (keydown.enter)="addProperty()" />
        <datalist [id]="propsListId">
          @for (p of availableProperties(); track p.name) { <option [value]="p.name">{{ p.type }}</option> }
        </datalist>
        <button (click)="addProperty()" [disabled]="!newProperty().trim()">Add property</button>
        @if (availableProperties().length) {
          <span class="hint">{{ availableProperties().length }} more in {{ sourceNames() }}</span>
        }
      </div>
    </section>
  `,
})
export class ModelEditor {
  readonly store = inject(EditorStore);
  readonly name = input.required<string>();
  readonly newProperty = signal('');
  readonly typesListId = uniqueId('types');
  readonly propsListId = uniqueId('props');
  readonly commentValue = commentValue;

  readonly entry = computed(() => (this.store.get([this.name()]) ?? {}) as ModelEntry);
  readonly comment = computed(() => commentText(this.entry().$comment));
  readonly propertyNames = computed(() => (isPlainObject(this.entry().properties) ? Object.keys(this.entry().properties!) : []));
  readonly catalogModel = computed(() => this.store.catalog().get(this.name()));
  readonly sourceNames = computed(() => this.catalogModel()?.sources.map(fileName).join(', ') ?? '');
  readonly otherTypes = computed(() => this.store.allModelTypes().filter((t) => t !== this.name()));
  readonly availableProperties = computed(() => {
    const present = new Set(this.propertyNames());
    return (this.catalogModel()?.properties ?? []).filter((p) => !present.has(p.name) && !p.navigation);
  });

  at(...keys: (string | number)[]): Path {
    return [this.name(), ...keys];
  }

  set(key: string, value: Json | undefined): void {
    this.store.update(this.at(key), value);
  }

  addProperty(): void {
    const name = this.newProperty().trim();
    if (!name) return;
    if (!this.propertyNames().includes(name)) this.store.update(this.at('properties', name), {});
    this.newProperty.set('');
  }
}
