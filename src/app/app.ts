import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { type ModelSource, fileName } from '../lib/sources';
import { EditorStore } from './editor-store';
import { host } from './host';
import { uniqueId } from './inline-issues';
import { ModelEditor } from './model-editor';
import { DocumentEditor, IssuesPanel, JsonView, TesterPanel } from './panels';

type Pane = 'json' | 'issues' | 'test';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelEditor, DocumentEditor, JsonView, IssuesPanel, TesterPanel],
  template: `
    <header class="toolbar">
      <button (click)="store.newFile()" title="Ctrl+N">New</button>
      <button (click)="store.open()" title="Ctrl+O">Open…</button>
      <button (click)="store.save()" title="Ctrl+S" [class.primary]="store.dirty()">Save</button>
      <button (click)="store.saveAs()" title="Ctrl+Shift+S">Save as…</button>
      <span class="sep"></span>
      <button (click)="store.addSources()" title="Ctrl+M">Add source…</button>
      <button (click)="store.reloadSources()" [disabled]="!store.sources().length" title="F5">Reload sources</button>
      <span class="spacer"></span>
      <span class="file" [title]="store.filePath() ?? ''">{{ store.dirty() ? '● ' : '' }}{{ store.filePath() ?? 'Untitled' }}</span>
    </header>

    <div class="layout">
      <nav class="sidebar">
        <button class="nav-item" [class.selected]="store.selection().kind === 'document'" (click)="store.select({ kind: 'document' })">
          Document <small>$schema, $comment, global rules</small>
        </button>

        <div class="nav-title">Model types <span class="count">{{ store.modelTypes().length }}</span></div>
        @for (m of store.modelTypes(); track m) {
          <button class="nav-item" [class.selected]="isSelected(m)" (click)="store.select({ kind: 'model', name: m })">
            <span>{{ m }}</span>
            @if (extendsOf(m); as parent) { <small>extends {{ parent }}</small> }
            <span class="spacer"></span>
            @if (counts().get(m); as c) {
              @if (c.errors) { <span class="badge error-badge">{{ c.errors }}</span> }
              @if (c.warnings) { <span class="badge warning-badge">{{ c.warnings }}</span> }
            }
          </button>
        }
        <div class="add-row">
          <input [attr.list]="typesListId" placeholder="model type…" [value]="newModel()" (input)="newModel.set($any($event.target).value)" (keydown.enter)="addModel()" />
          <datalist [id]="typesListId">
            @for (t of missingTypes(); track t) { <option [value]="t"></option> }
          </datalist>
          <button (click)="addModel()" [disabled]="!newModel().trim()">Add</button>
        </div>

        <div class="nav-title">Sources <span class="count">{{ store.sources().length }}</span></div>
        @for (s of store.sources(); track s.path) {
          <div class="source" [class.failed]="!!s.error" [title]="s.path">
            <span class="badge kind">{{ s.kind === 'breeze' ? 'Breeze' : s.kind === 'ts' ? 'TS' : 'C#' }}</span>
            <span class="source-name">{{ fileName(s.path) }}</span>
            <span class="spacer"></span>
            <button class="icon" title="Remove source" (click)="store.removeSource(s.path)">✕</button>
            <div class="source-detail">
              @if (s.error) { <span class="error-text">{{ s.error }}</span> }
              @else { {{ sourceSummary(s) }} · read {{ time(s.loadedAt) }} · watched }
            </div>
          </div>
        } @empty {
          <div class="hint">Add Breeze metadata, or TypeScript / C# files with view models, DTOs and the app's own validators and expression functions, to pick them from lists. They're re-read when they change.</div>
        }

        <div class="nav-title">Settings</div>
        <label class="setting">Other validators <small>(the app registers them, but they're in no source file; comma-separated)</small>
          <input [value]="store.settings().customValidators.join(', ')" placeholder="e.g. loginAvailable" (change)="setCustom($any($event.target).value)" />
        </label>
        <label class="setting check">
          <input type="checkbox" [checked]="store.settings().camelCase" (change)="store.updateSettings({ camelCase: $any($event.target).checked })" />
          camelCase server names (Breeze nameOnServer, C#)
        </label>
      </nav>

      <main class="main">
        @switch (store.selection().kind) {
          @case ('document') { <app-document-editor /> }
          @case ('model') {
            @if (selectedModel(); as name) { <app-model-editor [name]="name" /> }
          }
        }
      </main>

      <aside class="side">
        <div class="tabs">
          <button [class.active]="pane() === 'json'" (click)="pane.set('json')">JSON</button>
          <button [class.active]="pane() === 'issues'" (click)="pane.set('issues')">
            Issues
            @if (store.errorCount()) { <span class="badge error-badge">{{ store.errorCount() }}</span> }
            @if (warningCount()) { <span class="badge warning-badge">{{ warningCount() }}</span> }
          </button>
          <button [class.active]="pane() === 'test'" (click)="pane.set('test')">Try it</button>
        </div>
        <div class="pane">
          @switch (pane()) {
            @case ('json') { <app-json-view /> }
            @case ('issues') { <app-issues-panel /> }
            @case ('test') { <app-tester-panel /> }
          }
        </div>
      </aside>
    </div>

    <footer class="statusbar">
      <span>{{ store.status() }}</span>
      <span class="spacer"></span>
      <span>{{ store.modelTypes().length }} model types · {{ store.catalog().size }} known from sources ·
        @if (store.errorCount()) { <span class="error-text">{{ store.errorCount() }} errors</span> } @else { no errors }</span>
    </footer>
  `,
})
export class App {
  readonly store = inject(EditorStore);
  readonly pane = signal<Pane>('json');
  readonly newModel = signal('');
  readonly typesListId = uniqueId('model-types');
  readonly fileName = fileName;

  readonly selectedModel = computed(() => {
    const s = this.store.selection();
    return s.kind === 'model' && this.store.modelTypes().includes(s.name) ? s.name : undefined;
  });
  readonly missingTypes = computed(() => [...this.store.catalog().keys()].filter((t) => !this.store.modelTypes().includes(t)));
  readonly warningCount = computed(() => this.store.issues().filter((i) => i.severity === 'warning').length);
  readonly counts = computed(() => {
    const counts = new Map<string, { errors: number; warnings: number }>();
    for (const issue of this.store.issues()) {
      const key = issue.path[0];
      if (typeof key !== 'string') continue;
      const c = counts.get(key) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') c.errors++;
      if (issue.severity === 'warning') c.warnings++;
      counts.set(key, c);
    }
    return counts;
  });

  constructor() {
    effect(() => host.setTitle(this.store.title()));
    // Clicking an issue shows it in the JSON view.
    effect(() => {
      if (this.store.focusPath()) this.pane.set('json');
    });

    host.onMenu((command) => {
      switch (command) {
        case 'new': return void this.store.newFile();
        case 'open': return void this.store.open();
        case 'save': return void this.store.save();
        case 'saveAs': return void this.store.saveAs();
        case 'addSource': return void this.store.addSources();
        case 'reloadSources': return void this.store.reloadSources();
      }
    });
    host.onCloseRequested(async () => {
      if (await this.store.confirmDiscard()) host.close();
    });
    void host.startupArgs().then(async (args) => {
      if (args.file) await this.store.openPath(args.file);
      if (args.sources.length) await this.store.loadSourcePaths(args.sources);
    });
  }

  isSelected(name: string): boolean {
    const s = this.store.selection();
    return s.kind === 'model' && s.name === name;
  }

  extendsOf(name: string): string | undefined {
    const entry = this.store.doc()[name] as { extends?: string } | undefined;
    return typeof entry?.extends === 'string' ? entry.extends : undefined;
  }

  addModel(): void {
    this.store.addModel(this.newModel());
    this.newModel.set('');
  }

  setCustom(text: string): void {
    this.store.updateSettings({ customValidators: text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) });
  }

  sourceSummary(s: ModelSource): string {
    const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    return [
      count(s.models.length, 'type'),
      s.validators?.length ? count(s.validators.length, 'validator') : '',
      s.functions?.length ? count(s.functions.length, 'function') : '',
    ].filter(Boolean).join(' · ');
  }

  time(ms: number): string {
    return new Date(ms).toLocaleTimeString();
  }
}
