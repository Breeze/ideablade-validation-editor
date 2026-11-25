import type { ThemeSetting } from './theme';
import type { JsonObject } from '../../lib/doc';
import type { SourceFunction, SourceModel, SourceValidator } from '../../lib/sources';

// What the Electron preload script (electron/preload.ts) exposes as `window.editorHost`. The main process declares
// the same shapes in electron/types.ts; keep the two in step.

export interface OpenedFile {
  path: string;
  text: string;
  /** For a TypeScript file: its models, read by the main process (electron/typescript/models.ts and app-validators.ts). */
  models?: SourceModel[];
  validators?: SourceValidator[];
  functions?: SourceFunction[];
  parseError?: string;
}

export interface SourceChange {
  path: string;
  text?: string;
  error?: string;
  models?: SourceModel[];
  validators?: SourceValidator[];
  functions?: SourceFunction[];
  parseError?: string;
}

export interface StartupArgs {
  /** Metadata files to open: JSON, TypeScript or C#. */
  files: string[];
  sources: string[];
}

/** A metadata map found in a TypeScript file (electron/typescript/metadata-read.ts). */
export interface TsMetadata {
  name: string;
  json: JsonObject;
  /** Why the editor can't edit it, for a map with code in it (a spread, a reference to a variable...). */
  readOnly?: string;
  hasComments: boolean;
}

/** A sidebar selection: a metadata file (and the map in it, for TS and C#), and its settings or one of its models. */
export interface SavedSelection {
  path?: string;
  name?: string;
  kind: 'document' | 'model';
  model?: string;
}

/** Values to try against a pattern rule: ones it should accept and ones it should reject. */
export interface RegexTestSet {
  shouldPass: string[];
  shouldFail: string[];
}

/** A project (*.ivproj, electron/project/project-file.ts), with absolute paths. */
export interface Project {
  path: string;
  metadata: string[];
  /** The source entries as written: files, or patterns like `client/src/app/core/model/*.ts`. */
  sources: string[];
  /** The files they stand for now. */
  sourceFiles: string[];
  /** The pattern entries, absolute, with the files each matches now. */
  patterns: PatternMatch[];
  otherValidators: string[];
  camelCase: boolean;
  /** Values to try against each pattern rule, by rule (see EditorStore.regexTests). */
  regexTests?: Record<string, RegexTestSet>;
}

/** A source pattern (absolute, such as `C:\app\dtos\**\*.{ts,cs}`) and the files it matches. */
export interface PatternMatch {
  pattern: string;
  files: string[];
}

export interface ProjectState {
  metadata: string[];
  sources: string[];
  otherValidators: string[];
  camelCase: boolean;
  regexTests: Record<string, RegexTestSet>;
}

/** The sidebar's and the right pane's widths in pixels; a missing one is at its default. */
export interface PaneLayout {
  sidebar?: number;
  side?: number;
}

/** Folded in the sidebar: files by path, maps by path and name ('c:\x\client.ts#adminMetadata'); the paths in lower case, the names as they are. */
export interface SavedFolds {
  files: string[];
  maps: string[];
}

/** The two update settings (Settings in the sidebar); both on by default. */
export interface UpdateSettings {
  /** Check a few seconds after startup and every 4 hours. Help → Check for Updates… works either way. */
  checkAutomatically: boolean;
  /** Offer pre-releases (alpha, beta, rc) too, not only full releases. */
  includePrereleases: boolean;
}

/**
 * Where an update stands (electron/updates/updater.ts). 'available': found, the download starting; 'downloading':
 * `percent` done; 'ready': downloaded, installed on restart; 'notify': a newer version exists, but this install can't
 * update itself (macOS, the .deb), `url` is its release page; 'none': nothing newer; 'error': the check or download
 * failed (`message`).
 */
export interface UpdateStatus {
  state: 'available' | 'downloading' | 'ready' | 'notify' | 'none' | 'error';
  version?: string;
  percent?: number;
  url?: string;
  message?: string;
}

export interface EditorHost {
  openFile(title: string): Promise<OpenedFile[]>;
  readFile(path: string): Promise<OpenedFile>;
  saveFile(path: string, text: string): Promise<string>;
  /** Asks where to save; the format follows the extension the user picks. */
  /**
   * Asks where to save. A full path starts next to that file; a bare name (a new file) in the folder last chosen, else
   * `projectDir` (the open project's), else Documents.
   */
  chooseSavePath(suggestion: string, projectDir?: string): Promise<string | undefined>;
  readTsMetadata(text: string, fileName: string): Promise<TsMetadata[]>;
  writeTsMetadata(text: string, fileName: string, name: string, json: JsonObject): Promise<string>;
  /** The TS file with another metadata map added at the end (and the type's import, if missing). */
  insertTsMetadata(text: string, fileName: string, name: string, json: JsonObject): Promise<string>;
  /** The TS file without the metadata map `name` (its statement and doc comment). */
  removeTsMetadata(text: string, fileName: string, name: string): Promise<string>;
  newTsMetadata(name: string, json: JsonObject): Promise<string>;
  /** The *.ivproj in the folder of a file, or in the nearest folder above that has one. */
  findProject(filePath: string): Promise<string | undefined>;
  readProject(projectPath: string): Promise<Project>;
  writeProject(projectPath: string, state: ProjectState): Promise<Project>;
  chooseProjectPath(defaultDir?: string): Promise<string | undefined>;
  /** Source patterns made absolute (relative ones to `baseDir`), with the files each matches now. */
  expandPatterns(patterns: string[], baseDir?: string): Promise<PatternMatch[]>;
  /** Watches the folders these source patterns (absolute) point at; an empty list stops watching. */
  watchPatterns(patterns: string[]): Promise<void>;
  /** Files appeared in or disappeared from a pattern's folder: each pattern's files now. */
  onPatternMatches(handler: (matches: PatternMatch[]) => void): () => void;
  /** Asks for a folder of sources (Add folder); undefined when cancelled. */
  chooseSourceFolder(defaultDir?: string): Promise<string | undefined>;
  confirm(message: string, detail: string, buttons: string[]): Promise<number>;
  openSources(): Promise<OpenedFile[]>;
  watchSources(paths: string[]): Promise<void>;
  onSourceChanged(handler: (change: SourceChange) => void): () => void;
  startupArgs(): Promise<StartupArgs>;
  setTitle(title: string): void;
  /** The native theme (window frame, menus, dialogs), and what prefers-color-scheme reports for "system". */
  setTheme(theme: ThemeSetting): void;
  /** What was selected in the sidebar for a workspace (a user setting, kept with the window's place). */
  getSelection(key: string): Promise<SavedSelection | undefined>;
  saveSelection(key: string, selection: SavedSelection): void;
  /** The sidebar's folded files (by path) and maps (path#name) for a workspace, kept with the selection. */
  getFolds(key: string): Promise<SavedFolds | undefined>;
  saveFolds(key: string, folds: SavedFolds): void;
  /** The panes' widths as the user left them (the splitters), kept with the window's place. */
  getLayout(): Promise<PaneLayout | undefined>;
  saveLayout(layout: PaneLayout): void;
  /** The update settings, kept in the main process's settings file. */
  getUpdateSettings(): Promise<UpdateSettings>;
  /** Changes either or both update settings (from the next check on); returns them as they are now. */
  setUpdateSettings(change: Partial<UpdateSettings>): Promise<UpdateSettings>;
  /** Where an update stands now, and each change to it. */
  getUpdateStatus(): Promise<UpdateStatus | undefined>;
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
  /** Restarts into the downloaded update. Ask about unsaved changes first: the window then closes without asking. */
  installUpdate(): void;
  /** Opens one of the project's release pages on GitHub in the browser (other URLs are ignored). */
  openReleasePage(url: string): void;
  /** Whether anything is unsaved, for File → Discard All Unsaved Changes. */
  setUnsaved(unsaved: boolean): void;
  /** Whether a project is open, for File → Close Project. */
  setProjectOpen(open: boolean): void;
  /** The project was closed: nothing to reopen at the next start. */
  projectClosed(): void;
  close(): void;
  /** The recent projects (File → Open Recent Project), the latest first, and each change to them. */
  getRecentProjects(): Promise<string[]>;
  onRecentProjects(handler: (paths: string[]) => void): () => void;
  /** A menu command, with its argument where it has one (File → Open Recent Project: the project's path). */
  onMenu(handler: (command: string, arg?: string) => void): () => void;
  onCloseRequested(handler: () => void): () => void;
}

declare global {
  interface Window {
    editorHost?: EditorHost;
  }
}

const noFileSystem = async (): Promise<never> => {
  throw new Error('No file system outside the desktop app.');
};

/** Outside Electron (`ng serve` in a browser) there is no file system: a stand-in that does nothing. */
const browserHost: EditorHost = {
  openFile: async () => [],
  readFile: noFileSystem,
  saveFile: async (path) => path,
  chooseSavePath: async () => undefined,
  readTsMetadata: noFileSystem,
  writeTsMetadata: noFileSystem,
  insertTsMetadata: noFileSystem,
  removeTsMetadata: noFileSystem,
  newTsMetadata: noFileSystem,
  findProject: async () => undefined,
  readProject: noFileSystem,
  writeProject: noFileSystem,
  chooseProjectPath: async () => undefined,
  expandPatterns: async (patterns) => patterns.map((pattern) => ({ pattern, files: [] })),
  watchPatterns: async () => {},
  onPatternMatches: () => () => {},
  chooseSourceFolder: async () => undefined,
  confirm: async (message, _detail, buttons) => (window.confirm(message) ? 0 : buttons.length - 1),
  openSources: async () => [],
  watchSources: async () => {},
  onSourceChanged: () => () => {},
  startupArgs: async () => ({ files: [], sources: [] }),
  setTitle: (title) => (document.title = title),
  setTheme: () => {},
  getSelection: async () => undefined,
  saveSelection: () => {},
  getFolds: async () => undefined,
  saveFolds: () => {},
  getLayout: async () => undefined,
  saveLayout: () => {},
  getUpdateSettings: async () => ({ checkAutomatically: true, includePrereleases: true }),
  setUpdateSettings: async (change) => ({ checkAutomatically: true, includePrereleases: true, ...change }),
  getUpdateStatus: async () => undefined,
  onUpdateStatus: () => () => {},
  installUpdate: () => {},
  openReleasePage: () => {},
  setUnsaved: () => {},
  setProjectOpen: () => {},
  projectClosed: () => {},
  close: () => window.close(),
  getRecentProjects: async () => [],
  onRecentProjects: () => () => {},
  onMenu: () => () => {},
  onCloseRequested: () => () => {},
};

export const host: EditorHost = window.editorHost ?? browserHost;
