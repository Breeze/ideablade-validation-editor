import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { modelKeys } from '../lib/doc';
import { type ModelSource, fileName } from '../lib/sources';
import type { PatternMatch } from './host';
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
/** The set with `key` added, or taken out if it was in it. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
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
      <button (click)="store.addSources()" title="Ctrl+M: Breeze metadata, TS or C# files">Add source…</button>
      <button (click)="store.addSourceFolder()" title="Ctrl+Shift+M: the TS and C# files in a folder and its subfolders, as a pattern; new files are picked up as they appear">Add folder…</button>
      <button (click)="store.reloadSources()" [disabled]="!store.sources().length" title="F5">Reload sources</button>
      <span class="spacer"></span>
      <span class="file" [title]="store.filePath() ?? ''">{{ store.filePath() ?? (store.active() ? 'Not saved yet' : '') }}</span>
    </header>

    <div class="layout" [style.grid-template-columns]="gridColumns()">
      <nav class="sidebar">
        <!-- Pinned at the top: the project, the Metadata heading with Collapse all / Expand all, and the search -->
        <div class="sidebar-top">
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

        <div class="nav-title">Metadata <span class="count">{{ store.documents().length }}</span>
          @if (store.documents().length) {
            <span class="spacer"></span>
            <button class="link fold-all" title="Fold every file and map down to its name" (click)="collapseAll()">Collapse all</button>
            <button class="link fold-all" title="Unfold every file and map" (click)="expandAll()">Expand all</button>
          }
        </div>
        @if (store.documents().length) {
          <div class="sidebar-search">
            <input #search type="search" placeholder="Find model types and maps…" title="Ctrl+Shift+F. Enter opens the first match, Esc clears it."
              aria-label="Find model types and maps" [value]="filter()" (input)="onFilter($any($event.target).value)"
              (keydown.escape)="clearFilter($event)" (keydown.enter)="openFirstMatch()" />
            @if (filtering()) { <span class="search-count" title="Model types that match, of all">{{ matchCount() }} of {{ modelTotal() }}</span> }
          </div>
        }
        </div>

        <!-- The files and maps, scrolling between the two -->
        <div class="sidebar-list">
        @for (g of fileGroups(); track g.key) {
          @if (showGroup(g)) {
          <div class="doc" [class.active]="g.docs.includes(store.active()!)" [class.drop-target]="dropOn() === g.key"
            (dragover)="overFile($event, g)" (dragleave)="leave($event, g.key)" (drop)="dropOnFile($event, g)">
            <div class="doc-head" [title]="g.docs[0].path() ?? 'Not saved yet'" (click)="store.select({ docId: g.docs[0].id, kind: 'document' })">
              <button class="icon twisty" [title]="fileFolded(g) ? 'Unfold' : 'Fold'" [attr.aria-expanded]="!fileFolded(g)" (click)="$event.stopPropagation(); toggleFile(g)">{{ fileFolded(g) ? '▸' : '▾' }}</button>
              <span class="badge kind">{{ formatLabels[g.docs[0].format()] }}</span>
              <span class="doc-name">@for (p of parts(g.docs[0].fileLabel()); track $index) {@if (p.match) {<mark>{{ p.text }}</mark>} @else {{{ p.text }}}}</span>
              @if (groupDirty(g)) { <span class="dirty" title="Unsaved changes">●</span> }
              @if (!hasMapLines(g) && g.docs[0].readOnly()) { <span class="badge muted" [title]="g.docs[0].readOnly()!">read-only</span> }
              <span class="spacer"></span>
              @if (groupErrors(g); as errors) { <span class="badge error-badge">{{ errors }}</span> }
              <button class="icon" title="Close: takes it out of the project, when there is one" (click)="$event.stopPropagation(); closeFile(g)">✕</button>
            </div>
            @if (!fileFolded(g)) {
            @if (canAddMap(g)) {
              <div class="add-row add-map">
                <input [placeholder]="g.docs[0].format() === 'ts' ? 'map name, e.g. adminMetadata' : 'map name, e.g. AdminJson'"
                  [title]="'Add another metadata map to ' + g.docs[0].fileLabel()" [value]="newMaps()[g.key] ?? ''"
                  (input)="setNewMap(g.key, $any($event.target).value)" (keydown.enter)="addMap(g)" />
                <button (click)="addMap(g)" [disabled]="!(newMaps()[g.key] ?? '').trim()">Add map</button>
              </div>
            }
            @for (d of g.docs; track d.id) {
            @if (showDoc(g, d)) {
            <div class="map-block" [class.drop-target]="dropOn() === d.id" (dragover)="overMap($event, d)" (dragleave)="leave($event, d.id)" (drop)="dropOnMap($event, d)">
            @if (hasMapLines(g)) {
              <div class="map-head" [class.selected]="isSelected(d)" (click)="store.select({ docId: d.id, kind: 'document' })"
                [title]="'The map ' + d.name() + ' in ' + d.fileLabel() + (d.readOnly() ? '' : '. Drag it onto another file to move it there')"
                [attr.draggable]="!d.readOnly()" (dragstart)="dragMap($event, d)" (dragend)="dragEnd()">
                <button class="icon twisty" [title]="mapFolded(d) ? 'Unfold' : 'Fold'" [attr.aria-expanded]="!mapFolded(d)" (click)="$event.stopPropagation(); toggleMap(d)">{{ mapFolded(d) ? '▸' : '▾' }}</button>
                <span class="map-name">@for (p of parts(d.name() ?? ''); track $index) {@if (p.match) {<mark>{{ p.text }}</mark>} @else {{{ p.text }}}}</span>
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
            @if (!mapFolded(d)) {
            @if (wholeDoc(g, d)) {
            <button class="nav-item sub" [class.selected]="isSelected(d)" (click)="store.select({ docId: d.id, kind: 'document' })">
              <small>{{ d.format() === 'json' ? '$schema, $comment, global rules' : '$comment, global rules' }}</small>
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
            @for (m of visibleModels(g, d); track m) {
              <button class="nav-item sub" [class.selected]="isSelected(d, m)" (click)="store.select({ docId: d.id, kind: 'model', name: m })"
                [attr.draggable]="!d.readOnly()" (dragstart)="dragModel($event, d, m)" (dragend)="dragEnd()"
                [title]="d.readOnly() ? m : m + ': drag it onto another map to move it there (merged if that map has it too)'">
                <span>@for (p of parts(m); track $index) {@if (p.match) {<mark>{{ p.text }}</mark>} @else {{{ p.text }}}}</span>
                @if (extendsOf(d, m); as parent) { <small>extends {{ parent }}</small> }
                <span class="spacer"></span>
                @if (modelCounts().get(d.id + '/' + m); as c) {
                  @if (c.errors) { <span class="badge error-badge">{{ c.errors }}</span> }
                  @if (c.warnings) { <span class="badge warning-badge">{{ c.warnings }}</span> }
                }
              </button>
            }
            }
            </div>
            }
            }
            }
          </div>
          }
        } @empty {
          <div class="hint">No metadata open. Open JSON files, or TypeScript or C# files that hold metadata, or start a new one.</div>
        }

        @if (nothingMatches()) { <div class="hint">No model type, map or file matches “{{ filter().trim() }}”. Esc clears the search.</div> }
        </div>

        <!-- Pinned at the bottom: the sources and the settings -->
        <div class="sidebar-bottom">
        <div class="nav-title">Sources <span class="count">{{ store.sources().length }}</span></div>
        @for (p of store.sourcePatterns(); track p.pattern) {
          <div class="source pattern" [title]="p.pattern">
            <button class="icon twisty" [title]="patternOpen(p.pattern) ? 'Fold' : 'Show its files'" [attr.aria-expanded]="patternOpen(p.pattern)" (click)="togglePattern(p.pattern)">{{ patternOpen(p.pattern) ? '▾' : '▸' }}</button>
            <span class="badge kind">Folder</span>
            <span class="pattern-count">{{ p.files.length }} {{ p.files.length === 1 ? 'file' : 'files' }}{{ patternErrors(p) ? ', ' + patternErrors(p) + ' not read' : '' }} · watched</span>
            <span class="spacer"></span>
            <button class="icon" title="Change the pattern" (click)="editPattern(p.pattern)">✎</button>
            <button class="icon" title="Remove the pattern and the sources it matched" (click)="store.removePattern(p.pattern)">✕</button>
            @if (editingPattern() === p.pattern) {
              <input class="pattern-input" [value]="store.patternLabel(p.pattern)" (keydown.enter)="commitPattern(p.pattern, $any($event.target).value)"
                (keydown.escape)="editingPattern.set(undefined)" (blur)="commitPattern(p.pattern, $any($event.target).value)" />
            } @else {
              <div class="pattern-text" title="Its files are sources, and new ones are picked up as they appear. Double-click to change it." (dblclick)="editPattern(p.pattern)">{{ store.patternLabel(p.pattern) }}</div>
            }
          </div>
          @if (patternOpen(p.pattern)) {
            @for (s of patternSources(p); track s.path) {
              <div class="source in-pattern" [class.failed]="!!s.error" [title]="s.path">
                <span class="badge kind">{{ s.kind === 'breeze' ? 'Breeze' : s.kind === 'ts' ? 'TS' : 'C#' }}</span>
                <span class="source-name">{{ fileName(s.path) }}</span>
                <div class="source-detail">
                  @if (s.error) { <span class="error-text">{{ s.error }}</span> }
                  @else { {{ sourceSummary(s) }} · read {{ time(s.loadedAt) }} · watched }
                </div>
              </div>
            } @empty {
              <div class="hint in-pattern">No files match yet. They're added as they appear.</div>
            }
          }
        }
        @for (s of looseSources(); track s.path) {
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
          @if (!store.sourcePatterns().length) {
          <div class="hint">Add Breeze metadata, or TypeScript / C# files with view models, DTOs and the app's own validators and expression functions, to pick them from lists. They're re-read when they change. Add folder takes a folder's TS and C# files, and picks up new ones as they appear.</div>
          }
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
        </div>
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
    // The sidebar's folds as they were left in this project (or file), whenever another one opens; a search from the
    // one before doesn't carry over.
    effect(() => {
      const key = this.store.workspaceKey();
      untracked(() => {
        this.filter.set('');
        this.addedWhileSearching.set(new Set());
        void this.loadFolds(key);
      });
    });
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
        case 'findInSidebar': return this.focusSearch();
        case 'addSource': return void this.store.addSources();
        case 'addSourceFolder': return void this.store.addSourceFolder();
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
    const name = (this.newModels()[docId] ?? '').trim();
    this.store.addModel(name, docId);
    this.keepInView(`${docId}/${name}`);
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
    if (!(await this.store.addMap(g.docs[g.docs.length - 1], this.newMaps()[g.key] ?? ''))) return;
    this.setNewMap(g.key, '');
    const added = this.store.active(); // addMap selects the new map
    if (added) this.keepInView(added.id);
  }

  // ---- Folding files and maps in the sidebar

  /**
   * Folded files (by their key: the path in lower case) and maps (mapKey): only their name line shows. A search shows
   * its matches anyway. Kept for each project with the user's settings (window-state.json), and restored when it opens.
   */
  private readonly foldedFiles = signal<ReadonlySet<string>>(new Set());
  private readonly foldedMaps = signal<ReadonlySet<string>>(new Set());
  /** The workspace whose folds are loaded: saving waits for that, so it doesn't overwrite them with none. */
  private foldsFor: string | undefined;

  /** A map by its file and name, which stay the same from one run to the next (its id doesn't). */
  private mapKey(d: MetadataDocument): string {
    const path = d.path();
    return path ? `${path.toLowerCase()}#${d.name() ?? ''}` : d.id;
  }

  fileFolded(g: FileGroup): boolean {
    return !this.filtering() && this.foldedFiles().has(g.key);
  }

  mapFolded(d: MetadataDocument): boolean {
    return !this.filtering() && this.foldedMaps().has(this.mapKey(d));
  }

  toggleFile(g: FileGroup): void {
    this.foldedFiles.update((set) => toggled(set, g.key));
    this.saveFolds();
  }

  toggleMap(d: MetadataDocument): void {
    this.foldedMaps.update((set) => toggled(set, this.mapKey(d)));
    this.saveFolds();
  }

  /** Every file folded down to its name, and every map in them too: unfolding one file shows its maps folded. */
  collapseAll(): void {
    const groups = this.fileGroups();
    this.foldedFiles.set(new Set(groups.map((g) => g.key)));
    this.foldedMaps.set(new Set(groups.filter((g) => this.hasMapLines(g)).flatMap((g) => g.docs.map((d) => this.mapKey(d)))));
    this.saveFolds();
  }

  /** Every file and map unfolded. */
  expandAll(): void {
    this.foldedFiles.set(new Set());
    this.foldedMaps.set(new Set());
    this.saveFolds();
  }

  /** The folds this workspace had last time; none for a workspace that had none. */
  private async loadFolds(key: string): Promise<void> {
    this.foldsFor = undefined;
    const folds = key ? await host.getFolds(key) : undefined;
    if (this.store.workspaceKey() !== key) return; // another one opened meanwhile
    this.foldedFiles.set(new Set(folds?.files ?? []));
    this.foldedMaps.set(new Set(folds?.maps ?? []));
    this.foldsFor = key || undefined;
  }

  /** Saved files and maps only: an unsaved document's id means nothing next time. */
  private saveFolds(): void {
    const key = this.store.workspaceKey();
    if (!key || this.foldsFor !== key) return;
    const saved = (set: ReadonlySet<string>) => [...set].filter((k) => !k.startsWith('doc'));
    host.saveFolds(key, { files: saved(this.foldedFiles()), maps: saved(this.foldedMaps()) });
  }

  // ---- Finding model types and maps: the sidebar's search field

  /** What's typed in the search field; empty: everything shows. */
  readonly filter = signal('');
  private readonly needle = computed(() => this.filter().trim().toLowerCase());
  readonly filtering = computed(() => this.needle() !== '');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');

  private hit(text: string | undefined): boolean {
    return !!text && text.toLowerCase().includes(this.needle());
  }

  /** A map shows in full when nothing is searched for, or its name or its file's name matches. */
  wholeDoc(g: FileGroup, d: MetadataDocument): boolean {
    return !this.filtering() || this.hit(g.docs[0].fileLabel()) || (this.hasMapLines(g) && this.hit(d.name()));
  }

  /** A map's model types that show: all of them, or the ones whose names match, and the ones added during this search. */
  visibleModels(g: FileGroup, d: MetadataDocument): string[] {
    const all = this.modelsOf(d);
    if (this.wholeDoc(g, d)) return all;
    const added = this.addedWhileSearching();
    return all.filter((m) => this.hit(m) || added.has(`${d.id}/${m}`));
  }

  showDoc(g: FileGroup, d: MetadataDocument): boolean {
    return this.wholeDoc(g, d) || this.addedWhileSearching().has(d.id) || this.visibleModels(g, d).length > 0;
  }

  /**
   * Model types (docId/name) and maps (docId) added while a search is on: they stay in view, matching or not, until
   * the search is cleared.
   */
  private readonly addedWhileSearching = signal<ReadonlySet<string>>(new Set());

  private keepInView(key: string): void {
    if (this.filtering()) this.addedWhileSearching.update((set) => new Set([...set, key]));
  }

  /** The search field changed. Cleared: back to the whole list, with the selection unfolded and scrolled into view. */
  onFilter(value: string): void {
    this.filter.set(value);
    if (value.trim()) return;
    this.addedWhileSearching.set(new Set());
    this.unfoldSelection();
    this.revealSelection();
  }

  /** Unfolds the file and the map the selection is in, so it shows. */
  private unfoldSelection(): void {
    const doc = this.store.active();
    if (!doc) return;
    const fileKey = doc.path()?.toLowerCase() ?? doc.id;
    const files = this.foldedFiles();
    const maps = this.foldedMaps();
    if (!files.has(fileKey) && !maps.has(this.mapKey(doc))) return;
    this.foldedFiles.set(new Set([...files].filter((k) => k !== fileKey)));
    this.foldedMaps.set(new Set([...maps].filter((k) => k !== this.mapKey(doc))));
    this.saveFolds();
  }

  /** Scrolls the selected entry into the middle of the list, once it's drawn, if it's out of sight. */
  private revealSelection(): void {
    setTimeout(() => {
      const list = document.querySelector('.sidebar-list');
      const selected = list?.querySelector<HTMLElement>('.nav-item.selected, .map-head.selected');
      if (!list || !selected) return;
      const l = list.getBoundingClientRect();
      const r = selected.getBoundingClientRect();
      if (r.top < l.top || r.bottom > l.bottom) selected.scrollIntoView({ block: 'center' });
    }, 50);
  }

  showGroup(g: FileGroup): boolean {
    return g.docs.some((d) => this.showDoc(g, d));
  }

  readonly modelTotal = computed(() => this.store.documents().reduce((n, d) => n + this.modelsOf(d).length, 0));
  /** The model types that show while searching (a matching map's or file's count in full). */
  readonly matchCount = computed(() =>
    this.fileGroups().reduce((n, g) => n + g.docs.reduce((m, d) => m + (this.showDoc(g, d) ? this.visibleModels(g, d).length : 0), 0), 0),
  );
  readonly nothingMatches = computed(() => this.filtering() && !this.fileGroups().some((g) => this.showGroup(g)));

  /** A name in pieces, the parts that match the search marked. */
  parts(text: string): { text: string; match: boolean }[] {
    const needle = this.needle();
    if (!needle) return [{ text, match: false }];
    const result: { text: string; match: boolean }[] = [];
    const lower = text.toLowerCase();
    let at = 0;
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
      if (i > at) result.push({ text: text.slice(at, i), match: false });
      result.push({ text: text.slice(i, i + needle.length), match: true });
      at = i + needle.length;
    }
    if (at < text.length) result.push({ text: text.slice(at), match: false });
    return result;
  }

  /** View → Find Model Type or Map (Ctrl+Shift+F). */
  focusSearch(): void {
    const input = this.searchBox()?.nativeElement;
    input?.focus();
    input?.select();
  }

  /** Esc: clears the search; with nothing in it, leaves the field. */
  clearFilter(event: Event): void {
    if (this.filter()) {
      event.preventDefault();
      this.onFilter('');
    } else {
      (event.target as HTMLInputElement).blur();
    }
  }

  /** Enter: opens the first model type that shows, or else the first map. */
  openFirstMatch(): void {
    for (const g of this.fileGroups()) {
      for (const d of g.docs) {
        if (!this.showDoc(g, d)) continue;
        const model = this.visibleModels(g, d)[0];
        this.store.select(model ? { docId: d.id, kind: 'model', name: model } : { docId: d.id, kind: 'document' });
        return;
      }
    }
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

  // ---- Source patterns in the Sources list: folded by default, the files they match under them

  private readonly openPatterns = signal<ReadonlySet<string>>(new Set());
  readonly editingPattern = signal<string | undefined>(undefined);

  /** ✎ or a double-click: the pattern becomes a text field, focused with its text selected. */
  editPattern(pattern: string): void {
    this.editingPattern.set(pattern);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.sidebar-bottom .pattern-input');
      input?.focus();
      input?.select();
    });
  }

  patternOpen(pattern: string): boolean {
    return this.openPatterns().has(pattern);
  }

  togglePattern(pattern: string): void {
    this.openPatterns.update((set) => {
      const next = new Set(set);
      if (!next.delete(pattern)) next.add(pattern);
      return next;
    });
  }

  /** The sources a pattern matched. */
  patternSources(p: PatternMatch): ModelSource[] {
    const files = new Set(p.files.map((f) => f.toLowerCase()));
    return this.store.sources().filter((s) => files.has(s.path.toLowerCase()));
  }

  patternErrors(p: PatternMatch): number {
    return this.patternSources(p).filter((s) => s.error).length;
  }

  /** The sources added one by one: no pattern matches them. */
  readonly looseSources = computed(() => this.store.sources().filter((s) => !this.store.fromPattern(s.path)));

  async commitPattern(old: string, text: string): Promise<void> {
    if (this.editingPattern() !== old) return; // Enter, then the blur it causes
    this.editingPattern.set(undefined);
    if (text.trim() && text.trim() !== this.store.patternLabel(old)) {
      // Shown unfolded again if it was.
      const index = this.store.sourcePatterns().findIndex((p) => p.pattern === old);
      if ((await this.store.changePattern(old, text)) && this.patternOpen(old)) {
        this.togglePattern(old);
        this.togglePattern(this.store.sourcePatterns()[index].pattern);
      }
    }
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
