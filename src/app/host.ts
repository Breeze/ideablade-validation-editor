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
}

export interface ProjectState {
  metadata: string[];
  sources: string[];
  otherValidators: string[];
  camelCase: boolean;
}

export interface EditorHost {
  openFile(title: string): Promise<OpenedFile[]>;
  readFile(path: string): Promise<OpenedFile>;
  saveFile(path: string, text: string): Promise<string>;
  /** Asks where to save; the format follows the extension the user picks. */
  chooseSavePath(defaultPath: string): Promise<string | undefined>;
  readTsMetadata(text: string, fileName: string): Promise<TsMetadata[]>;
  writeTsMetadata(text: string, fileName: string, name: string, json: JsonObject): Promise<string>;
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
  close(): void;
  onMenu(handler: (command: string) => void): () => void;
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
  close: () => window.close(),
  onMenu: () => () => {},
  onCloseRequested: () => () => {},
};

export const host: EditorHost = window.editorHost ?? browserHost;
