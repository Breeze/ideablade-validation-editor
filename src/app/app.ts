import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { DocumentEditor } from './components/document-editor/document-editor';
import { ModelEditor } from './components/model-editor/model-editor';
import { SidePane } from './components/side-pane/side-pane';
import { Sidebar } from './components/sidebar/sidebar';
import { StartPage } from './components/start-page/start-page';
import { StatusBar } from './components/status-bar/status-bar';
import { Toolbar } from './components/toolbar/toolbar';
import { EditorStore } from './services/editor-store';
import { host } from './services/host';
import type { DocFormat } from './services/metadata-document';
import { MetadataTree } from './services/metadata-tree';
import { applyTheme, onSystemThemeChange } from './services/theme';

// The panes' widths, in pixels: the sidebar's default and minimum, the right pane's minimum, the middle column's
// minimum, and the splitters between them.
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

/**
 * The editor's shell: the toolbar, then three columns (the sidebar, the main area, the right pane) with a splitter
 * between each, and the status bar. The main area shows the selected model type (ModelEditor), the selected map's own
 * settings (DocumentEditor), or the start page when nothing is open.
 *
 * The shell also does what belongs to the window as a whole: the application menu's commands (sent by the main
 * process, electron/window/menu.ts), the files given on the command line at startup, the window title, the colour theme,
 * asking about unsaved changes when the window closes, and the splitters (their widths are saved with the window's
 * place).
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Toolbar, Sidebar, StartPage, ModelEditor, DocumentEditor, SidePane, StatusBar],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly store = inject(EditorStore);
  private readonly tree = inject(MetadataTree);

  /** The model type the main area shows: the selection, when it's a model type that's still there. */
  readonly selectedModel = computed(() => {
    const s = this.store.selection();
    return s?.kind === 'model' && s.docId === this.store.active()?.id && this.store.modelTypes().includes(s.name) ? s.name : undefined;
  });

  constructor() {
    // The panes' widths as they were left, and kept fitting the window as it's resized.
    void host.getLayout().then((layout) => {
      if (layout?.sidebar) this.sidebarWidth.set(layout.sidebar);
      if (layout?.side) this.sideWidth.set(layout.side);
    });
    window.addEventListener('resize', () => this.windowWidth.set(window.innerWidth));
    effect(() => host.setTitle(this.store.title()));
    // The colour theme: <html data-theme>, and Electron's native theme for the window frame, menus and dialogs.
    effect(() => {
      const theme = this.store.settings().theme;
      host.setTheme(theme);
      applyTheme(theme);
    });
    onSystemThemeChange(() => applyTheme(this.store.settings().theme));

    // The application menu's commands (and their shortcuts).
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
        case 'findInSidebar': return this.tree.focusSearchRequest.update((n) => n + 1);
        case 'addSource': return void this.store.addSources();
        case 'addSourceFolder': return void this.store.addSourceFolder();
        case 'reloadSources': return void this.store.reloadSources();
        case 'openRecent': return void (arg && this.store.openPath(arg));
      }
    });
    // Closing the window: asks about unsaved changes first, and closes only if the user doesn't cancel.
    host.onCloseRequested(async () => {
      if (await this.store.confirmDiscard()) host.close();
    });
    // The files on the command line (or the project used last), then the selection as it was left.
    void host.startupArgs().then(async (args) => {
      for (const file of args.files) await this.store.openPath(file);
      if (args.sources.length) await this.store.loadSourcePaths(args.sources);
      // Back to the model selected last time, or the first one.
      await this.store.restoreSelection();
    });
  }

  // ---- Splitters: the sidebar's and the right pane's widths, dragged, kept with the window's place

  readonly sidebarWidth = signal(SIDEBAR_DEFAULT);
  readonly sideWidth = signal(0); // 0: not set yet, 38% of the window
  private readonly windowWidth = signal(window.innerWidth);
  /** The grid's columns: sidebar | splitter | middle | splitter | right pane. */
  readonly gridColumns = computed(() => {
    const side = this.sideWidth() || Math.round(this.windowWidth() * 0.38);
    const fitted = fitWidths(this.windowWidth(), this.sidebarWidth(), side);
    return `${fitted.sidebar}px ${SPLITTER}px minmax(${MAIN_MIN}px, 1fr) ${SPLITTER}px ${fitted.side}px`;
  });

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

  /** View → Reset Layout: the sidebar and the right pane back to their default widths (300 px, 38% of the window). */
  resetLayout(): void {
    this.sidebarWidth.set(SIDEBAR_DEFAULT);
    this.sideWidth.set(0);
    host.saveLayout({});
  }

  /** Double-clicking a splitter puts that pane back to its default width. */
  resetWidth(which: 'sidebar' | 'side'): void {
    if (which === 'sidebar') this.sidebarWidth.set(SIDEBAR_DEFAULT);
    else this.sideWidth.set(0);
    host.saveLayout({ sidebar: this.sidebarWidth(), side: this.sideWidth() || undefined });
  }
}
