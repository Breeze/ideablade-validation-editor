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

export interface EditorHost {
  openFile(title: string): Promise<OpenedFile[]>;
  readFile(path: string): Promise<OpenedFile>;
  saveFile(path: string, text: string): Promise<string>;
  /** Asks where to save; the format follows the extension the user picks. */
  chooseSavePath(defaultPath: string): Promise<string | undefined>;
  readTsMetadata(text: string, fileName: string): Promise<TsMetadata[]>;
  writeTsMetadata(text: string, fileName: string, name: string, json: JsonObject): Promise<string>;
  newTsMetadata(name: string, json: JsonObject): Promise<string>;
  confirm(message: string, detail: string, buttons: string[]): Promise<number>;
  openSources(): Promise<OpenedFile[]>;
  watchSources(paths: string[]): Promise<void>;
  onSourceChanged(handler: (change: SourceChange) => void): () => void;
  startupArgs(): Promise<StartupArgs>;
  setTitle(title: string): void;
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
  confirm: async (message, _detail, buttons) => (window.confirm(message) ? 0 : buttons.length - 1),
  openSources: async () => [],
  watchSources: async () => {},
  onSourceChanged: () => () => {},
  startupArgs: async () => ({ files: [], sources: [] }),
  setTitle: (title) => (document.title = title),
  close: () => window.close(),
  onMenu: () => () => {},
  onCloseRequested: () => () => {},
};

export const host: EditorHost = window.editorHost ?? browserHost;
