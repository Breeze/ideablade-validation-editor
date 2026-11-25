import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { modelKeys } from '../lib/doc';
import { type ModelSource, fileName } from '../lib/sources';
import { EditorStore, FORMAT_LABELS, type MetadataDocument } from './editor-store';
import { host } from './host';
import { THEME_LABELS, type ThemeSetting, applyTheme, onSystemThemeChange } from './theme';
import { uniqueId } from './inline-issues';
import { ModelEditor } from './model-editor';
import { JsonView } from './json-view';
import { DocumentEditor, IssuesPanel, TesterPanel } from './panels';

type Pane = 'json' | 'issues' | 'test';
interface Counts {
  errors: number;
  warnings: number;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelEditor, DocumentEditor, JsonView, IssuesPanel, TesterPanel],
  template: `
    <header class="toolbar">
      <button (click)="store.newFile()" title="Ctrl+N">New</button>
      <button (click)="store.open()" title="Ctrl+O: JSON, TypeScript or C# files">Open…</button>
      <button (click)="store.save()" title="Ctrl+S" [disabled]="!store.active()" [class.primary]="store.active()?.dirty()">Save</button>
      <button (click)="store.saveAs()" title="Ctrl+Shift+S: as JSON, TypeScript or C#" [disabled]="!store.active()">Save as…</button>
      <button (click)="store.saveAll()" title="Ctrl+Alt+S" [disabled]="!store.dirty()">Save all</button>
      <span class="sep"></span>
      <button (click)="store.addSources()" title="Ctrl+M">Add source…</button>
      <button (click)="store.reloadSources()" [disabled]="!store.sources().length" title="F5">Reload sources</button>
      <span class="spacer"></span>
      <span class="file" [title]="store.filePath() ?? ''">{{ store.filePath() ?? (store.active() ? 'Not saved yet' : '') }}</span>
    </header>

    <div class="layout">
      <nav class="sidebar">
        <div class="nav-title">Project</div>
        @if (store.project(); as p) {
          <div class="project" [title]="p.path">
            <span class="doc-name">{{ fileName(p.path) }}</span>
            @if (store.projectDirty()) { <span class="dirty" title="Unsaved changes: metadata files, sources or settings">●</span> }
            <span class="spacer"></span>
            <button (click)="store.saveProject()" [disabled]="!store.projectDirty()">Save</button>
          </div>
          <div class="hint">{{ p.metadata.length }} metadata {{ p.metadata.length === 1 ? 'file' : 'files' }} · {{ p.sources.length }} source {{ p.sources.length === 1 ? 'entry' : 'entries' }} · shared settings</div>
        } @else {
          <div class="add-row">
            <button (click)="store.saveProject()" [disabled]="!store.documents().length">Create project file…</button>
          </div>
          <div class="hint">A project file (*.ivproj) shares the metadata files, sources and settings with your team. The editor finds it next to a metadata file or in a folder above.</div>
        }

        <div class="nav-title">Metadata <span class="count">{{ store.documents().length }}</span></div>
        @for (d of store.documents(); track d.id) {
          <div class="doc" [class.active]="d === store.active()">
            <div class="doc-head" [title]="d.path() ?? 'Not saved yet'" (click)="store.select({ docId: d.id, kind: 'document' })">
              <span class="badge kind">{{ formatLabels[d.format()] }}</span>
              <span class="doc-name">{{ d.label() }}</span>
              @if (d.dirty()) { <span class="dirty" title="Unsaved changes">●</span> }
              @if (d.readOnly()) { <span class="badge muted" [title]="d.readOnly()!">read-only</span> }
              <span class="spacer"></span>
              @if (docCounts().get(d.id); as c) {
                @if (c.errors) { <span class="badge error-badge">{{ c.errors }}</span> }
              }
              <button class="icon" title="Close: takes it out of the project, when there is one" (click)="$event.stopPropagation(); store.closeDocument(d.id)">✕</button>
            </div>
            <button class="nav-item sub" [class.selected]="isSelected(d)" (click)="store.select({ docId: d.id, kind: 'document' })">
              <small>{{ d.format() === 'json' ? '$schema, $comment, global rules' : '$comment, global rules' }}</small>
            </button>
            @for (m of modelsOf(d); track m) {
              <button class="nav-item sub" [class.selected]="isSelected(d, m)" (click)="store.select({ docId: d.id, kind: 'model', name: m })">
                <span>{{ m }}</span>
                @if (extendsOf(d, m); as parent) { <small>extends {{ parent }}</small> }
                <span class="spacer"></span>
                @if (modelCounts().get(d.id + '/' + m); as c) {
                  @if (c.errors) { <span class="badge error-badge">{{ c.errors }}</span> }
                  @if (c.warnings) { <span class="badge warning-badge">{{ c.warnings }}</span> }
                }
              </button>
            }
            @if (!d.readOnly()) {
              <div class="add-row add-model">
                <input [attr.list]="typesListId + '-' + d.id" placeholder="model type…" [title]="'Add a model type to ' + d.label()"
                  [value]="newModels()[d.id] ?? ''" (input)="setNewModel(d.id, $any($event.target).value)" (keydown.enter)="addModel(d.id)" />
                <datalist [id]="typesListId + '-' + d.id">
                  @for (t of missingTypesOf(d); track t) { <option [value]="t"></option> }
                </datalist>
                <button (click)="addModel(d.id)" [disabled]="!(newModels()[d.id] ?? '').trim()">Add</button>
              </div>
            }
          </div>
        } @empty {
          <div class="hint">No metadata open. Open JSON files, or TypeScript or C# files that hold metadata, or start a new one.</div>
        }

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
        <label class="setting">Theme
          <select (change)="store.updateSettings({ theme: $any($event.target).value })">
            @for (t of themes; track t) { <option [value]="t" [selected]="store.settings().theme === t">{{ themeLabels[t] }}</option> }
          </select>
        </label>
      </nav>

      <main class="main">
        @if (!store.active()) {
          <div class="empty-state">
            <p>Open a project (<code>*.ivproj</code>), or File → Open Recent Project, or validation metadata: JSON files, TypeScript files with a <code>ModelValidationMetadataMap</code>, or C# files with the metadata as a JSON string. Open several to edit them side by side; the checks see them together, as the library merges them.</p>
            <button class="primary" (click)="store.open()">Open…</button> <button (click)="store.newFile()">New</button>
          </div>
        } @else if (selectedModel(); as name) {
          @if (store.readOnly(); as reason) { <div class="banner">Read-only: {{ reason }}</div> }
          <app-model-editor [name]="name" />
        } @else {
          <app-document-editor />
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
      <span>{{ store.documents().length }} metadata {{ store.documents().length === 1 ? 'map' : 'maps' }} · {{ store.metadataTypes().length }} model types ·
        {{ store.catalog().size }} known from sources ·
        @if (store.errorCount()) { <span class="error-text">{{ store.errorCount() }} {{ store.errorCount() === 1 ? 'error' : 'errors' }}</span> } @else { no errors }
        @if (warningCount()) { · <span class="warning-text">{{ warningCount() }} {{ warningCount() === 1 ? 'warning' : 'warnings' }}</span> }</span>
    </footer>
  `,
})
export class App {
  readonly store = inject(EditorStore);
  readonly pane = signal<Pane>('json');
  /** What's typed in each metadata file's "model type…" field, by document. */
  readonly newModels = signal<Record<string, string>>({});
  readonly typesListId = uniqueId('model-types');
  readonly fileName = fileName;
  readonly formatLabels = FORMAT_LABELS;
  readonly themes: ThemeSetting[] = ['dark', 'light', 'system'];
  readonly themeLabels = THEME_LABELS;

  readonly selectedModel = computed(() => {
    const s = this.store.selection();
    return s?.kind === 'model' && s.docId === this.store.active()?.id && this.store.modelTypes().includes(s.name) ? s.name : undefined;
  });
  readonly warningCount = computed(() => this.store.allIssues().filter((i) => i.severity === 'warning').length);
  readonly modelCounts = computed(() => this.count((i) => (typeof i.path[0] === 'string' ? `${i.docId}/${i.path[0]}` : undefined)));
  readonly docCounts = computed(() => this.count((i) => i.docId));

  constructor() {
    effect(() => host.setTitle(this.store.title()));
    // The colour theme: <html data-theme>, and Electron's native theme for the window frame, menus and dialogs.
    effect(() => {
      const theme = this.store.settings().theme;
      host.setTheme(theme);
      applyTheme(theme);
    });
    onSystemThemeChange(() => applyTheme(this.store.settings().theme));
    // Clicking an issue shows it in the JSON view.
    effect(() => {
      if (this.store.focusPath()) this.pane.set('json');
    });

    host.onMenu((command, arg) => {
      switch (command) {
        case 'new': return void this.store.newFile();
        case 'open': return void this.store.open();
        case 'save': return void this.store.save();
        case 'saveAs': return void this.store.saveAs();
        case 'saveAll': return void this.store.saveAll();
        case 'closeProject': return void this.store.closeProject();
        case 'addSource': return void this.store.addSources();
        case 'reloadSources': return void this.store.reloadSources();
        case 'openRecent': return void (arg && this.store.openPath(arg));
      }
    });
    host.onCloseRequested(async () => {
      if (await this.store.confirmDiscard()) host.close();
    });
    void host.startupArgs().then(async (args) => {
      for (const file of args.files) await this.store.openPath(file);
      if (args.sources.length) await this.store.loadSourcePaths(args.sources);
      // Back to the model selected last time, or the first one.
      await this.store.restoreSelection();
    });
  }

  private count(keyOf: (i: { docId: string; path: (string | number)[] }) => string | undefined): Map<string, Counts> {
    const counts = new Map<string, Counts>();
    for (const issue of this.store.allIssues()) {
      const key = keyOf(issue);
      if (!key) continue;
      const c = counts.get(key) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') c.errors++;
      if (issue.severity === 'warning') c.warnings++;
      counts.set(key, c);
    }
    return counts;
  }

  modelsOf(d: MetadataDocument): string[] {
    return modelKeys(d.doc());
  }

  isSelected(d: MetadataDocument, model?: string): boolean {
    const s = this.store.selection();
    if (!s || s.docId !== d.id || d !== this.store.active()) return false;
    return model === undefined ? s.kind === 'document' : s.kind === 'model' && s.name === model;
  }

  extendsOf(d: MetadataDocument, name: string): string | undefined {
    const entry = d.doc()[name] as { extends?: string } | undefined;
    return typeof entry?.extends === 'string' ? entry.extends : undefined;
  }

  /** Model types the sources know that this file doesn't have yet, offered when adding one to it. */
  missingTypesOf(d: MetadataDocument): string[] {
    const have = new Set(this.modelsOf(d));
    return this.store.allModelTypes().filter((t) => !have.has(t));
  }

  setNewModel(docId: string, value: string): void {
    this.newModels.update((all) => ({ ...all, [docId]: value }));
  }

  addModel(docId: string): void {
    this.store.addModel(this.newModels()[docId] ?? '', docId);
    this.setNewModel(docId, '');
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
