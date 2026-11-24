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
  file?: string;
  sources: string[];
}

export interface EditorHost {
  openFile(title: string): Promise<OpenedFile | undefined>;
  readFile(path: string): Promise<OpenedFile>;
  saveFile(path: string, text: string): Promise<string>;
  saveFileAs(defaultPath: string, text: string): Promise<string | undefined>;
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

/** Outside Electron (`ng serve` in a browser) there is no file system: a stand-in that does nothing. */
const browserHost: EditorHost = {
  openFile: async () => undefined,
  readFile: async (path) => {
    throw new Error(`No file system outside the desktop app (${path}).`);
  },
  saveFile: async (path) => path,
  saveFileAs: async () => undefined,
  confirm: async (message, _detail, buttons) => (window.confirm(message) ? 0 : buttons.length - 1),
  openSources: async () => [],
  watchSources: async () => {},
  onSourceChanged: () => () => {},
  startupArgs: async () => ({ sources: [] }),
  setTitle: (title) => (document.title = title),
  close: () => window.close(),
  onMenu: () => () => {},
  onCloseRequested: () => () => {},
};

export const host: EditorHost = window.editorHost ?? browserHost;
