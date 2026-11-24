import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { type Issue } from '../lib/check';
import { DEFAULT_SCHEMA_URL, type Json, lineOfPath } from '../lib/doc';
import { type TestResult, runTest, sampleFor } from '../lib/tester';
import { schemaVersion } from '../generated/schema-validator';
import { EditorStore } from './editor-store';
import { InlineIssues, commentText, commentValue } from './inline-issues';
import { RuleList } from './rule-list';

/** The document's own settings: `$schema`, `$comment` and the global rules. */
@Component({
  selector: 'app-document-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleList],
  template: `
    <h2>Document</h2>
    <section>
      <label>$schema <small>(for editors; the loaders ignore it)</small>
        <input class="code" [value]="schema()" (input)="set('$schema', $any($event.target).value || undefined)" />
      </label>
      <div class="hint">Checked here against the schema of ideablade-validation {{ schemaVersion }}.
        @if (!schema()) { <button class="link" (click)="set('$schema', defaultSchema)">Add the schema URL</button> }
      </div>
      <label>$comment <small>(one paragraph per line)</small>
        <textarea class="comment" rows="6" [value]="comment()" (change)="set('$comment', commentValue($any($event.target).value))"></textarea>
      </label>
      <app-inline-issues [path]="['$comment']" />
    </section>
    <section>
      <div class="section-title">Global rules <small>(model-level rules for every model type, such as breeze)</small></div>
      <app-rule-list [path]="['global', 'validators']" />
      <app-inline-issues [path]="['global']" [exact]="true" />
    </section>
  `,
})
export class DocumentEditor {
  private readonly store = inject(EditorStore);
  readonly schemaVersion = schemaVersion;
  readonly defaultSchema = DEFAULT_SCHEMA_URL;
  readonly commentValue = commentValue;
  readonly schema = computed(() => (typeof this.store.doc()['$schema'] === 'string' ? (this.store.doc()['$schema'] as string) : ''));
  readonly comment = computed(() => commentText(this.store.doc()['$comment']));

  set(key: string, value: Json | undefined): void {
    this.store.update([key], value);
  }
}

/** The raw JSON, kept in step with the forms in both directions. */
@Component({
  selector: 'app-json-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <textarea #area class="json" spellcheck="false" [value]="text()" (input)="store.setJsonText($any($event.target).value)"></textarea>
    @if (store.invalidText(); as invalid) {
      <div class="json-error">Not applied, the JSON doesn't parse: {{ invalid.error }}</div>
    }
  `,
})
export class JsonView {
  readonly store = inject(EditorStore);
  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');
  readonly text = computed(() => this.store.invalidText()?.text ?? this.store.jsonText());

  constructor() {
    // Scroll to (and select the line of) what the clicked issue is about.
    effect(() => {
      const path = this.store.focusPath();
      if (!path) return;
      const area = this.area().nativeElement;
      const text = untracked(this.text); // only a new focus path scrolls, not every edit
      const line = lineOfPath(text, path) ?? 1;
      const lines = text.split('\n');
      const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 16;
      area.scrollTop = Math.max(0, (line - 5) * lineHeight);
      area.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    });
  }
}

@Component({
  selector: 'app-issues-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (issue of store.issues(); track $index) {
      <button class="issue" [class]="issue.severity" (click)="store.focusIssue(issue)">
        <span class="sev">{{ icon(issue) }}</span>
        <span class="where">{{ where(issue) }}</span>
        <span class="msg">{{ issue.message }}</span>
        <span class="origin">{{ issue.origin }}</span>
      </button>
    } @empty {
      <div class="empty ok">No issues: the schema and the library accept this metadata.</div>
    }
  `,
})
export class IssuesPanel {
  readonly store = inject(EditorStore);
  icon(issue: Issue): string {
    return issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '!' : 'i';
  }
  where(issue: Issue): string {
    return issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join(' › ') || '(document)';
  }
}

/** "Try it": validate a sample object with the library and the metadata as it is now. */
@Component({
  selector: 'app-tester-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tester">
      <label>Model type
        <select (change)="modelType.set($any($event.target).value)">
          @for (t of store.modelTypes(); track t) { <option [value]="t" [selected]="t === modelType()">{{ t }}</option> }
        </select>
      </label>
      <label>Sample object <button class="link" (click)="fillSample()">fill from the model</button>
        <textarea class="code" rows="10" spellcheck="false" [value]="sample()" (input)="sample.set($any($event.target).value)"></textarea>
      </label>
      <label>Store <small>(entities by type, for store('Type') in expressions)</small>
        <textarea class="code" rows="3" spellcheck="false" [value]="storeText()" placeholder='{ "Address": [{ "staffingResourceId": 1 }] }' (input)="storeText.set($any($event.target).value)"></textarea>
      </label>
      <div class="add-row">
        <button class="primary" (click)="run()">Validate</button>
        <label class="check"><input type="checkbox" [checked]="auto()" (change)="auto.set($any($event.target).checked)" /> re-run on every change</label>
      </div>
      <div class="hint">Validators the editor doesn't have (breeze, custom ones) always pass here; async validators are not run.</div>
      @if (result(); as r) {
        @if (r.failure) {
          <div class="inline-issue error">{{ r.failure }}</div>
        } @else if (r.errors!.length === 0) {
          <div class="empty ok">Valid: no errors.</div>
        } @else {
          <table class="results">
            <tr><th>Key</th><th>Message</th><th>About</th></tr>
            @for (e of r.errors; track $index) {
              <tr><td><code>{{ e.key }}</code></td><td>{{ e.message }}</td><td>{{ e.propertyNames.join(', ') || '(model)' }}</td></tr>
            }
          </table>
        }
      }
    </div>
  `,
})
export class TesterPanel {
  readonly store = inject(EditorStore);
  readonly modelTypeChoice = signal<string | undefined>(undefined);
  readonly modelType = signal<string>('');
  readonly sample = signal('{}');
  readonly storeText = signal('');
  readonly auto = signal(true);
  readonly result = signal<TestResult | undefined>(undefined);

  constructor() {
    // Follow the model selected in the editor.
    effect(() => {
      const selection = this.store.selection();
      if (selection.kind === 'model' && selection.name !== untracked(this.modelType)) {
        untracked(() => {
          this.modelType.set(selection.name);
          this.fillSample();
          this.result.set(undefined);
        });
      }
    });
    effect(() => {
      this.store.doc();
      this.sample();
      this.storeText();
      this.store.settings();
      this.store.catalog();
      if (this.auto() && this.modelType()) untracked(() => this.run());
    });
  }

  fillSample(): void {
    const type = this.modelType();
    this.sample.set(sampleFor(type, this.store.doc(), this.store.catalog().get(type)));
  }

  run(): void {
    this.result.set(
      runTest(this.store.doc(), this.modelType(), this.sample(), this.storeText(), this.store.settings().customValidators, this.store.catalog()),
    );
  }
}
