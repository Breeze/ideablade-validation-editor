import type { ThemeSetting } from './theme';
import type { JsonObject } from '../lib/doc';
import type { SourceFunction, SourceModel, SourceValidator } from '../lib/sources';

// What the Electron preload script (electron/preload.cjs) exposes as `window.editorHost`.

export interface OpenedFile {
  path: string;
  text: string;
  /** For a TypeScript file: its models, read by the main process (electron/typescript-models.cjs). */
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

/** A metadata map found in a TypeScript file (electron/typescript-metadata.cjs). */
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

/** A project (*.ivproj, electron/project.cjs), with absolute paths. */
export interface Project {
  path: string;
  metadata: string[];
  /** The source entries as written: files, or patterns like `client/src/app/core/model/*.ts`. */
  sources: string[];
  /** The files they stand for now. */
  sourceFiles: string[];
  otherValidators: string[];
  camelCase: boolean;
  /** Values to try against each pattern rule, by rule (see EditorStore.regexTests). */
  regexTests?: Record<string, RegexTestSet>;
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
  newTsMetadata(name: string, json: JsonObject): Promise<string>;
  /** The *.ivproj in the folder of a file, or in the nearest folder above that has one. */
  findProject(filePath: string): Promise<string | undefined>;
  readProject(projectPath: string): Promise<Project>;
  writeProject(projectPath: string, state: ProjectState): Promise<Project>;
  chooseProjectPath(defaultDir?: string): Promise<string | undefined>;
  /** Watches the folders of the project's source patterns (none for undefined). */
  watchProject(projectPath: string | undefined): Promise<void>;
  /** Files appeared in or disappeared from a pattern folder: the patterns' files now. */
  onProjectFilesChanged(handler: (change: { path: string; sourceFiles: string[] }) => void): () => void;
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
  /** The panes' widths as the user left them (the splitters), kept with the window's place. */
  getLayout(): Promise<PaneLayout | undefined>;
  saveLayout(layout: PaneLayout): void;
  /** Whether a project is open, for File → Close Project. */
  setProjectOpen(open: boolean): void;
  /** The project was closed: nothing to reopen at the next start. */
  projectClosed(): void;
  close(): void;
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
  newTsMetadata: noFileSystem,
  findProject: async () => undefined,
  readProject: noFileSystem,
  writeProject: noFileSystem,
  chooseProjectPath: async () => undefined,
  watchProject: async () => {},
  onProjectFilesChanged: () => () => {},
  confirm: async (message, _detail, buttons) => (window.confirm(message) ? 0 : buttons.length - 1),
  openSources: async () => [],
  watchSources: async () => {},
  onSourceChanged: () => () => {},
  startupArgs: async () => ({ files: [], sources: [] }),
  setTitle: (title) => (document.title = title),
  setTheme: () => {},
  getSelection: async () => undefined,
  saveSelection: () => {},
  getLayout: async () => undefined,
  saveLayout: () => {},
  setProjectOpen: () => {},
  projectClosed: () => {},
  close: () => window.close(),
  onMenu: () => () => {},
  onCloseRequested: () => () => {},
};

export const host: EditorHost = window.editorHost ?? browserHost;
