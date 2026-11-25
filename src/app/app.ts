import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { modelKeys } from '../lib/doc';
import { type ModelSource, fileName } from '../lib/sources';
import { type DocFormat, EditorStore, FORMAT_LABELS, type MetadataDocument } from './editor-store';
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
/** A metadata file in the sidebar: its maps (one for JSON; one or more for TS and C#), or an unsaved document. */
interface FileGroup {
  key: string;
  docs: MetadataDocument[];
}

const SIDEBAR_DEFAULT = 300;
const SIDEBAR_MIN = 200;
const SIDE_MIN = 320;
const MAIN_MIN = 460;
const SPLITTER = 5;

/**
 * The sidebar's and the right pane's widths, made to fit: each at least its minimum, and the middle column left at
 * least its own. When the window is too narrow for what was set, the right pane gives way first, then the sidebar.
 */
function fitWidths(windowWidth: number, sidebar: number, side: number): { sidebar: number; side: number } {
  sidebar = Math.max(SIDEBAR_MIN, Math.round(sidebar));
  side = Math.max(SIDE_MIN, Math.round(side));
  const room = windowWidth - MAIN_MIN - 2 * SPLITTER;
  if (sidebar + side > room) side = Math.max(SIDE_MIN, room - sidebar);
  if (sidebar + side > room) sidebar = Math.max(SIDEBAR_MIN, room - side);
  return { sidebar, side };
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelEditor, DocumentEditor, JsonView, IssuesPanel, TesterPanel],
  template: `
    <header class="toolbar">
      <span class="menu-button">
        <button (click)="newMenuOpen.set(!newMenuOpen())" (blur)="closeNewMenuSoon()" [class.open]="newMenuOpen()" title="A new metadata file: JSON, TypeScript or C#">New ▾</button>
        @if (newMenuOpen()) {
          <span class="menu">
            @for (f of newFormats; track f.format) {
              <button (mousedown)="$event.preventDefault()" (click)="newFile(f.format)" [title]="f.hint">{{ f.label }}</button>
            }
          </span>
        }
      </span>
      <button (click)="store.open()" title="Ctrl+O: JSON, TypeScript or C# files">Open…</button>
      <button (click)="store.save()" title="Ctrl+S" [disabled]="!store.active()" [class.primary]="store.active()?.dirty() || store.removalsIn(store.active()?.path()).length > 0">Save</button>
      <button (click)="store.saveAs()" title="Ctrl+Shift+S: as JSON, TypeScript or C#" [disabled]="!store.active()">Save as…</button>
      <button (click)="store.saveAll()" title="Ctrl+Alt+S" [disabled]="!store.dirty()">Save all</button>
      <button (click)="store.discardAll()" title="Discard all unsaved changes: the files are read again from disk (asks first)" [disabled]="!store.dirty()">Discard all</button>
      <span class="sep"></span>
      <button (click)="store.addSources()" title="Ctrl+M">Add source…</button>
      <button (click)="store.reloadSources()" [disabled]="!store.sources().length" title="F5">Reload sources</button>
      <span class="spacer"></span>
      <span class="file" [title]="store.filePath() ?? ''">{{ store.filePath() ?? (store.active() ? 'Not saved yet' : '') }}</span>
    </header>

    <div class="layout" [style.grid-template-columns]="gridColumns()">
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
        @for (g of fileGroups(); track g.key) {
          <div class="doc" [class.active]="g.docs.includes(store.active()!)" [class.drop-target]="dropOn() === g.key"
            (dragover)="overFile($event, g)" (dragleave)="leave($event, g.key)" (drop)="dropOnFile($event, g)">
            <div class="doc-head" [title]="g.docs[0].path() ?? 'Not saved yet'" (click)="store.select({ docId: g.docs[0].id, kind: 'document' })">
              <span class="badge kind">{{ formatLabels[g.docs[0].format()] }}</span>
              <span class="doc-name">{{ g.docs[0].fileLabel() }}</span>
              @if (groupDirty(g)) { <span class="dirty" title="Unsaved changes">●</span> }
              @if (!hasMapLines(g) && g.docs[0].readOnly()) { <span class="badge muted" [title]="g.docs[0].readOnly()!">read-only</span> }
              <span class="spacer"></span>
              @if (groupErrors(g); as errors) { <span class="badge error-badge">{{ errors }}</span> }
              <button class="icon" title="Close: takes it out of the project, when there is one" (click)="$event.stopPropagation(); closeFile(g)">✕</button>
            </div>
            @for (d of g.docs; track d.id) {
            <div class="map-block" [class.drop-target]="dropOn() === d.id" (dragover)="overMap($event, d)" (dragleave)="leave($event, d.id)" (drop)="dropOnMap($event, d)">
            @if (hasMapLines(g)) {
              <div class="map-head" [class.selected]="isSelected(d)" (click)="store.select({ docId: d.id, kind: 'document' })"
                [title]="'The map ' + d.name() + ' in ' + d.fileLabel() + (d.readOnly() ? '' : '. Drag it onto another file to move it there')"
                [attr.draggable]="!d.readOnly()" (dragstart)="dragMap($event, d)" (dragend)="dragEnd()">
                <span class="map-name">{{ d.name() }}</span>
                @if (d.newInFile()) { <span class="badge muted" title="Saving writes it into the file">new</span> }
                @else if (d.dirty()) { <span class="dirty" title="Unsaved changes">●</span> }
                @if (d.readOnly()) { <span class="badge muted" [title]="d.readOnly()!">read-only</span> }
                <span class="spacer"></span>
                @if (g.docs.length > 1) {
                  @if (docCounts().get(d.id)?.errors; as errors) { <span class="badge error-badge">{{ errors }}</span> }
                }
                @if (d.newInFile()) {
                  <button class="icon" title="Remove this new map (it isn't in the file yet)" (click)="$event.stopPropagation(); store.removeNewMap(d.id)">✕</button>
                } @else if (g.docs.length > 1) {
                  <button class="icon" title="Remove this map: it's deleted from the file when you save it" (click)="$event.stopPropagation(); store.removeMap(d.id)">✕</button>
                }
              </div>
            }
            <button class="nav-item sub" [class.selected]="isSelected(d)" (click)="store.select({ docId: d.id, kind: 'document' })">
              <small>{{ d.format() === 'json' ? '$schema, $comment, global rules' : '$comment, global rules' }}</small>
            </button>
            @for (m of modelsOf(d); track m) {
              <button class="nav-item sub" [class.selected]="isSelected(d, m)" (click)="store.select({ docId: d.id, kind: 'model', name: m })"
                [attr.draggable]="!d.readOnly()" (dragstart)="dragModel($event, d, m)" (dragend)="dragEnd()"
                [title]="d.readOnly() ? m : m + ': drag it onto another map to move it there (merged if that map has it too)'">
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
            }
            @if (canAddMap(g)) {
              <div class="add-row add-map">
                <input [placeholder]="g.docs[0].format() === 'ts' ? 'map name, e.g. adminMetadata' : 'map name, e.g. AdminJson'"
                  [title]="'Add another metadata map to ' + g.docs[0].fileLabel()" [value]="newMaps()[g.key] ?? ''"
                  (input)="setNewMap(g.key, $any($event.target).value)" (keydown.enter)="addMap(g)" />
                <button (click)="addMap(g)" [disabled]="!(newMaps()[g.key] ?? '').trim()">Add map</button>
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
      <div class="splitter" title="Drag to make the sidebar wider or narrower (Esc while dragging cancels); double-click for its default width"
        (pointerdown)="startResize('sidebar', $event)" (dblclick)="resetWidth('sidebar')"></div>

      <main class="main">
        @if (!store.active()) {
          <div class="empty-state">
            <p>Open a project (<code>*.ivproj</code>), or File → Open Recent Project, or validation metadata: JSON files, TypeScript files with a <code>ModelValidationMetadataMap</code>, or C# files with the metadata as a JSON string. Open several to edit them side by side; the checks see them together, as the library merges them.</p>
            <button class="primary" (click)="store.open()">Open…</button>
            @for (f of newFormats; track f.format) { <button (click)="newFile(f.format)" [title]="f.hint">New {{ f.label }}</button> }
            @if (recentProjects().length) {
              <div class="recent">
                <div class="nav-title">Recent projects</div>
                @for (p of recentProjects(); track p) {
                  <button class="recent-project" [title]="'Open ' + p" (click)="store.openPath(p)">
                    <span class="recent-name">{{ fileName(p) }}</span>
                    <span class="recent-folder">{{ folderOf(p) }}</span>
                  </button>
                }
              </div>
            }
          </div>
        } @else if (selectedModel(); as name) {
          @if (store.readOnly(); as reason) { <div class="banner">Read-only: {{ reason }}</div> }
          <app-model-editor [name]="name" />
        } @else {
          <app-document-editor />
        }
      </main>
      <div class="splitter" title="Drag to make this pane wider or narrower (Esc while dragging cancels); double-click for its default width"
        (pointerdown)="startResize('side', $event)" (dblclick)="resetWidth('side')"></div>

      <aside class="side">
        <div class="tabs">
          <button [class.active]="pane() === 'json'" (click)="pane.set('json')">{{ codeTabLabel() }}</button>
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
  /** The New button's choices, as in File → New. */
  readonly newFormats: { format: DocFormat; label: string; hint: string }[] = [
    { format: 'json', label: 'JSON', hint: 'Ctrl+N: a validation.metadata.json file' },
    { format: 'ts', label: 'TypeScript', hint: 'A .ts file exporting a typed ModelValidationMetadataMap' },
    { format: 'cs', label: 'C#', hint: 'A .cs file with the JSON as a constant and the typed map parsed from it' },
  ];
  readonly newMenuOpen = signal(false);
  /** File → Open Recent Project's list, also shown on the page when nothing is open. */
  readonly recentProjects = signal<string[]>([]);
  /** The code tab is named after what the selected document is saved as. */
  readonly codeTabLabel = computed(() => ({ ts: 'TypeScript', cs: 'C#' })[this.store.active()?.format() as 'ts' | 'cs'] ?? 'JSON');
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
    // The panes' widths as they were left, and kept fitting the window as it's resized.
    void host.getLayout().then((layout) => {
      if (layout?.sidebar) this.sidebarWidth.set(layout.sidebar);
      if (layout?.side) this.sideWidth.set(layout.side);
    });
    window.addEventListener('resize', () => this.windowWidth.set(window.innerWidth));
    void host.getRecentProjects().then((paths) => this.recentProjects.set(paths));
    host.onRecentProjects((paths) => this.recentProjects.set(paths));
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
        case 'new': return void this.store.newFile((arg as DocFormat | undefined) ?? 'json');
        case 'open': return void this.store.open();
        case 'save': return void this.store.save();
        case 'saveAs': return void this.store.saveAs();
        case 'saveAll': return void this.store.saveAll();
        case 'discardAll': return void this.store.discardAll();
        case 'closeProject': return void this.store.closeProject();
        case 'resetLayout': return this.resetLayout();
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

  newFile(format: DocFormat): void {
    this.newMenuOpen.set(false);
    this.store.newFile(format);
  }

  /** Closes the New menu when focus leaves its button (after a click on a choice has gone through). */
  closeNewMenuSoon(): void {
    setTimeout(() => this.newMenuOpen.set(false), 150);
  }

  /** The folder a project is in, for the recent list. */
  folderOf(path: string): string {
    return path.replace(/[\\/][^\\/]*$/, '');
  }

  setNewModel(docId: string, value: string): void {
    this.newModels.update((all) => ({ ...all, [docId]: value }));
  }

  addModel(docId: string): void {
    this.store.addModel(this.newModels()[docId] ?? '', docId);
    this.setNewModel(docId, '');
  }

  // ---- Metadata files in the sidebar: a TS or C# file's maps together under the file

  /** The documents by file, in their order; an unsaved document is a group of its own. */
  readonly fileGroups = computed(() => {
    const groups: FileGroup[] = [];
    for (const d of this.store.documents()) {
      const key = d.path()?.toLowerCase() ?? d.id;
      const group = groups.find((g) => g.key === key);
      if (group) group.docs.push(d);
      else groups.push({ key, docs: [d] });
    }
    return groups;
  });
  /** What's typed in each TS or C# file's "map name" field, by file. */
  readonly newMaps = signal<Record<string, string>>({});

  /** Saved TS and C# maps show their name on a line of their own, under the file name. */
  hasMapLines(g: FileGroup): boolean {
    return !!g.docs[0].path() && g.docs[0].format() !== 'json';
  }

  canAddMap(g: FileGroup): boolean {
    return this.hasMapLines(g);
  }

  groupDirty(g: FileGroup): boolean {
    return g.docs.some((d) => d.dirty()) || this.store.removalsIn(g.docs[0].path()).length > 0;
  }

  groupErrors(g: FileGroup): number {
    return g.docs.reduce((sum, d) => sum + (this.docCounts().get(d.id)?.errors ?? 0), 0);
  }

  setNewMap(key: string, value: string): void {
    this.newMaps.update((all) => ({ ...all, [key]: value }));
  }

  async addMap(g: FileGroup): Promise<void> {
    if (await this.store.addMap(g.docs[g.docs.length - 1], this.newMaps()[g.key] ?? '')) this.setNewMap(g.key, '');
  }

  // ---- Dragging model types onto maps, and maps onto files

  /** What's being dragged in the sidebar, and where it would land (a map's id, or a file's key). */
  readonly dragging = signal<{ kind: 'model'; docId: string; name: string } | { kind: 'map'; docId: string } | undefined>(undefined);
  readonly dropOn = signal<string | undefined>(undefined);

  dragModel(event: DragEvent, d: MetadataDocument, name: string): void {
    this.dragging.set({ kind: 'model', docId: d.id, name });
    event.dataTransfer?.setData('text/plain', name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  dragMap(event: DragEvent, d: MetadataDocument): void {
    this.dragging.set({ kind: 'map', docId: d.id });
    event.dataTransfer?.setData('text/plain', d.name() ?? '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  dragEnd(): void {
    this.dragging.set(undefined);
    this.dropOn.set(undefined);
  }

  /** Over a map's lines: a model type can be dropped there. */
  overMap(event: DragEvent, d: MetadataDocument): void {
    const drag = this.dragging();
    if (drag?.kind !== 'model' || !this.store.canMoveModel(drag.docId, drag.name, d.id)) return; // a map goes to the file
    this.accept(event, d.id);
  }

  /** Over a file: a map can be dropped there; a model type too, on a file with one map (its header). */
  overFile(event: DragEvent, g: FileGroup): void {
    const drag = this.dragging();
    if (drag?.kind === 'map' && this.store.canMoveMap(drag.docId, g.docs[0].id)) this.accept(event, g.key);
    else if (drag?.kind === 'model' && g.docs.length === 1 && this.store.canMoveModel(drag.docId, drag.name, g.docs[0].id)) this.accept(event, g.docs[0].id);
  }

  private accept(event: DragEvent, target: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropOn.set(target);
  }

  /** Leaving a target (not just moving onto one of its children). */
  leave(event: DragEvent, target: string): void {
    const into = event.relatedTarget as Node | null;
    if (this.dropOn() === target && !(into && (event.currentTarget as HTMLElement).contains(into))) this.dropOn.set(undefined);
  }

  dropOnMap(event: DragEvent, d: MetadataDocument): void {
    const drag = this.dragging();
    if (drag?.kind !== 'model') return;
    event.preventDefault();
    event.stopPropagation();
    this.dragEnd();
    void this.store.moveModel(drag.docId, drag.name, d.id);
  }

  dropOnFile(event: DragEvent, g: FileGroup): void {
    const drag = this.dragging();
    if (!drag) return;
    event.preventDefault();
    this.dragEnd();
    if (drag.kind === 'map') void this.store.moveMap(drag.docId, g.docs[0].id);
    else if (g.docs.length === 1) void this.store.moveModel(drag.docId, drag.name, g.docs[0].id);
  }

  /** The file's ✕: closes each of its maps, asking about unsaved changes; stops at a Cancel. */
  async closeFile(g: FileGroup): Promise<void> {
    for (const d of g.docs) {
      await this.store.closeDocument(d.id);
      if (this.store.documents().includes(d)) return; // cancelled
    }
  }

  // ---- Splitters: the sidebar's and the right pane's widths, dragged, kept with the window's place

  readonly sidebarWidth = signal(SIDEBAR_DEFAULT);
  readonly sideWidth = signal(0); // 0: not set yet, 38% of the window
  readonly gridColumns = computed(() => {
    const side = this.sideWidth() || Math.round(this.windowWidth() * 0.38);
    const fitted = fitWidths(this.windowWidth(), this.sidebarWidth(), side);
    return `${fitted.sidebar}px ${SPLITTER}px minmax(${MAIN_MIN}px, 1fr) ${SPLITTER}px ${fitted.side}px`;
  });
  private readonly windowWidth = signal(window.innerWidth);

  /** Drags a splitter. Esc before letting go puts both widths back as they were, and nothing is saved. */
  startResize(which: 'sidebar' | 'side', event: PointerEvent): void {
    if (event.button !== 0) return;
    // No text selection from this press: once Esc ends the drag the button is still down, and a selection made then
    // would be dragged by the next splitter drag, which the browser then cancels.
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const handle = event.target as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const before = { sidebar: this.sidebarWidth(), side: this.sideWidth() };
    const start = fitWidths(this.windowWidth(), this.sidebarWidth(), this.sideWidth() || Math.round(this.windowWidth() * 0.38));
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (which === 'sidebar') {
        this.sidebarWidth.set(fitWidths(this.windowWidth(), start.sidebar + dx, start.side).sidebar);
      } else {
        this.sideWidth.set(fitWidths(this.windowWidth(), start.sidebar, start.side - dx).side);
      }
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    const end = () => {
      stop();
      host.saveLayout({ sidebar: this.sidebarWidth(), side: this.sideWidth() || undefined });
    };
    const cancel = () => {
      stop();
      this.sidebarWidth.set(before.sidebar);
      this.sideWidth.set(before.side);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation(); // the drag's, not a dialog's or an editor's
      cancel();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
  }

  /** Double-clicking a splitter puts that pane back to its default width. */
  /** View → Reset Layout: the sidebar and the right pane back to their default widths (300 px, 38% of the window). */
  resetLayout(): void {
    this.sidebarWidth.set(SIDEBAR_DEFAULT);
    this.sideWidth.set(0);
    host.saveLayout({});
  }

  resetWidth(which: 'sidebar' | 'side'): void {
    if (which === 'sidebar') this.sidebarWidth.set(SIDEBAR_DEFAULT);
    else this.sideWidth.set(0);
    host.saveLayout({ sidebar: this.sidebarWidth(), side: this.sideWidth() || undefined });
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
