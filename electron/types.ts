// The payloads that cross between the main process and the renderer: what the IPC handlers (ipc/*.ts) take and
// return, and what preload.ts passes along. Several main-process files use each of them, so they're kept here, in one
// place, rather than with whichever file happens to produce them. The renderer has its own view of the same shapes
// (src/app/services/host.ts, and SourceModel and friends in src/lib/sources.ts); keep the two in step.
//
// Types only: this compiles to an empty module, so the sandboxed preload script can import it (type-only) too.

// ---------------------------------------------------------------------------------------------------------------
// JSON, as the metadata maps hold it

/** A JSON value, as the metadata maps hold them. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** A JSON object: a metadata map, or a part of one. */
export type JsonObject = { [key: string]: JsonValue };

/** A metadata map found in a TypeScript file (typescript/metadata-read.ts). */
export interface TsMetadata {
  name: string;
  json: JsonObject;
  /** Why the editor can't edit it, for a map with code in it (a spread, a reference to a variable...). */
  readOnly?: string;
  /** Comments inside the literal, which rewriting it would drop. */
  hasComments: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Files read for the renderer, with what a TypeScript file holds (typescript/models.ts, typescript/app-validators.ts)

/** A model's property, as the source writes it. */
export interface SourceProperty {
  name: string;
  /** The type text, or `= <initializer>` for an untyped class field. */
  type: string;
  nullable?: boolean;
}

/** A model: an interface, an object type alias or a class. */
export interface SourceModel {
  name: string;
  kind: 'interface' | 'type' | 'class';
  /** The type it extends, by name as written. */
  base?: string;
  properties: SourceProperty[];
}

/** A validator the application registers itself. */
export interface SourceValidator {
  name: string;
  /** Registered as an asynchronous / synchronous validator (both when the file has both). */
  async: boolean;
  sync: boolean;
  defaultMessage?: string;
  /** Context settings its code reads: ctx.factor, ... */
  settings: string[];
  description?: string;
  /** The type of value the validator's code works with, where it shows (see valueKindsOf in typescript/app-validators.ts). */
  valueType?: string;
}

/** A function or value the application adds to the expression scope. */
export interface SourceFunction {
  name: string;
  /** Parameters, for a function; undefined for a value. */
  params?: string[];
  returns?: string;
  description?: string;
}

/** A file read for the renderer: its path and text, and (for a TS file) what was found in it, or why not. */
export interface ReadFile {
  path: string;
  text?: string;
  error?: string;
  models?: SourceModel[];
  validators?: SourceValidator[];
  functions?: SourceFunction[];
  parseError?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// The project file (project/project-file.ts) and source patterns (project/source-patterns.ts)

/** Values to try against a pattern rule: ones it should accept and ones it should reject. */
export interface RegexTestSet {
  shouldPass: string[];
  shouldFail: string[];
}

/** A project file as read, with absolute paths (`sources` as written: files or patterns). */
export interface ParsedProject {
  path: string;
  metadata: string[];
  sources: string[];
  otherValidators: string[];
  camelCase: boolean;
  regexTests: Record<string, RegexTestSet>;
}

/** A source pattern, absolute, and the files it matches now. */
export interface PatternMatch {
  pattern: string;
  files: string[];
}

/** The project as the renderer gets it: the parsed file plus what its source entries stand for now. */
export interface Project extends ParsedProject {
  /** The files the source entries stand for now, which the editor loads. */
  sourceFiles: string[];
  /** The pattern entries with the files each matches. */
  patterns: PatternMatch[];
}

/** What the renderer asks to write (its ProjectState, with absolute paths). Missing tests mean none. */
export interface ProjectToWrite {
  metadata: string[];
  sources: string[];
  otherValidators: string[];
  camelCase: boolean;
  regexTests?: Record<string, RegexTestSet>;
}

// ---------------------------------------------------------------------------------------------------------------
// The user's settings (settings/user-settings.ts)

/** A sidebar selection: a metadata file (and the map in it, for TS and C#), and its settings or one of its models. */
export interface SavedSelection {
  path?: string;
  name?: string;
  kind: 'document' | 'model';
  model?: string;
}

/** Folded in the sidebar: files by path, maps by path and name ('c:\x\client.ts#adminMetadata'). */
export interface SavedFolds {
  files: string[];
  maps: string[];
}

/** The sidebar's and the right pane's widths in pixels; a missing one is at its default. */
export interface PaneLayout {
  sidebar?: number;
  side?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Updates (updates/updater.ts)

/** The two update settings (Settings in the sidebar), kept in the settings file; both on by default. */
export interface UpdateSettings {
  /** Check a few seconds after startup and every 4 hours. Help → Check for Updates… works either way. */
  checkAutomatically: boolean;
  /** Offer pre-releases (alpha, beta, rc) too, not only full releases. */
  includePrereleases: boolean;
}

/**
 * Where an update stands, for the status bar. 'available': found, the download starting; 'downloading': `percent`
 * done; 'ready': downloaded, installed on restart (or on quit); 'notify': a newer version exists, but this install
 * can't update itself (macOS, the .deb), so `url` is its release page; 'none': nothing newer (`version` is this one);
 * 'error': the check or the download failed (`message`).
 */
export interface UpdateStatus {
  state: 'available' | 'downloading' | 'ready' | 'notify' | 'none' | 'error';
  version?: string;
  percent?: number;
  url?: string;
  message?: string;
}
