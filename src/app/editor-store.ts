import { Injectable, computed, effect, signal } from '@angular/core';

import { type ValidatorInfo, validatorCatalog } from '../lib/catalog';
import { type Issue, checkDocument } from '../lib/check';
import type { CompletionEnv } from '../lib/completion';
import { newCsMetadataFile, pascalCaseFromFile, readCsMetadata, writeCsMetadata } from '../lib/cs-metadata';
import {
  type Json,
  type MetadataDoc,
  type Path,
  type RuleEntry,
  type ValidatorObject,
  getIn,
  isPlainObject,
  mergeDocs,
  modelKeys,
  newDocument,
  renameKey,
  setIn,
  stringify,
} from '../lib/doc';
import { type ModelSource, appFunctions, appValidators, buildCatalog, fileName, parseSource } from '../lib/sources';
import { type Project, type ProjectState, type RegexTestSet, host } from './host';
import type { ThemeSetting } from './theme';

/** Where a document is kept: a JSON file, or a metadata map in a TypeScript or C# file. */
export type DocFormat = 'json' | 'ts' | 'cs';

/** What Save as suggests for a new document, by format; the TS constant and C# class are named after the file. */
const NEW_FILE_NAMES: Record<DocFormat, string> = {
  json: 'validation.metadata.json',
  ts: 'validation-metadata.ts',
  cs: 'ValidationMetadata.cs',
};
const NEW_TS_NAME = 'validationMetadata';

export function formatOf(path: string): DocFormat {
  return /\.tsx?$/i.test(path) ? 'ts' : /\.cs$/i.test(path) ? 'cs' : 'json';
}

export const FORMAT_LABELS: Record<DocFormat, string> = { json: 'JSON', ts: 'TS', cs: 'C#' };

let nextId = 0;

/**
 * One open metadata map: a JSON file, or one map in a TypeScript or C# file (a file can hold several). The document
 * is the parsed JSON itself; edits replace it, and everything else is computed from it.
 */
export class MetadataDocument {
  readonly id = `doc${++nextId}`;
  readonly path = signal<string | undefined>(undefined);
  readonly format = signal<DocFormat>('json');
  /** For TS and C#: the variable or constant that holds the map in the file. */
  readonly name = signal<string | undefined>(undefined);
  readonly doc = signal<MetadataDoc>({});
  /** Why it can't be edited: a TS map with code in it, such as a spread of another map. */
  readonly readOnly = signal<string | undefined>(undefined);
  /** The TS object or C# JSON has comments inside it, which saving drops. */
  readonly hasComments = signal(false);
  /** JSON view text that doesn't parse (the document stays at its last valid state). */
  readonly invalidText = signal<{ text: string; error: string } | undefined>(undefined);
  /** The JSON as typed in the JSON view (or read from the file), as long as it's the current document. */
  private readonly rawText = signal<{ doc: MetadataDoc; text: string } | undefined>(undefined);
  /** What was last saved or loaded: the file text for JSON, the formatted JSON for TS and C#. */
  private readonly saved = signal('');

  readonly jsonText = computed(() => {
    const raw = this.rawText();
    return raw && raw.doc === this.doc() ? raw.text : stringify(this.doc());
  });
  readonly dirty = computed(
    () => !!this.invalidText() || (this.format() === 'json' ? this.jsonText() : stringify(this.doc())) !== this.saved(),
  );
  readonly fileLabel = computed(() => (this.path() ? fileName(this.path()!) : 'Untitled'));
  readonly label = computed(() => (this.format() !== 'json' && this.name() ? `${this.fileLabel()} › ${this.name()}` : this.fileLabel()));

  constructor(init: { path?: string; format?: DocFormat; name?: string; doc: MetadataDoc; text?: string; readOnly?: string; hasComments?: boolean }) {
    this.path.set(init.path);
    this.format.set(init.format ?? 'json');
    this.name.set(init.name);
    this.doc.set(init.doc);
    this.readOnly.set(init.readOnly);
    this.hasComments.set(!!init.hasComments);
    if (init.text !== undefined && this.format() === 'json') this.rawText.set({ doc: init.doc, text: init.text });
    this.markSaved(init.text);
  }

  markSaved(jsonFileText?: string): void {
    this.saved.set(this.format() === 'json' ? (jsonFileText ?? this.jsonText()) : stringify(this.doc()));
  }

  setDoc(doc: MetadataDoc): void {
    this.invalidText.set(undefined);
    this.doc.set(doc);
  }

  setJsonText(text: string): void {
    try {
      const parsed = JSON.parse(text) as Json;
      if (!isPlainObject(parsed)) throw new Error('The metadata must be a JSON object.');
      this.invalidText.set(undefined);
      this.rawText.set({ doc: parsed, text });
      this.doc.set(parsed);
    } catch (e) {
      this.invalidText.set({ text, error: (e as Error).message });
    }
  }

  /** A JSON file that doesn't parse opens with its text in the JSON view, to be fixed there. */
  setInvalid(text: string, error: string): void {
    this.invalidText.set({ text, error });
  }
}

/** What the main area shows: a document's own settings (global rules, `$comment`) or one of its model types. */
export type Selection = { docId: string; kind: 'document' } | { docId: string; kind: 'model'; name: string };

/** An issue with the document it's in. */
export interface DocIssue extends Issue {
  docId: string;
}

const SETTINGS_KEY = 'editor.settings';
const SOURCES_KEY = (file: string) => `editor.sources:${file.toLowerCase()}`;
/** The project file's extension (IdeaBlade Validation Project): the editor finds one next to a metadata file or in a folder above it. */
export const PROJECT_EXTENSION = '.ivproj';

function projectLabel(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : path;
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const lower = (list: readonly string[]) => new Set(list.map((p) => p.toLowerCase()));
  const x = lower(a);
  const y = lower(b);
  return x.size === y.size && [...x].every((p) => y.has(p));
}

/** JSON with sorted keys, to compare objects whatever order their keys were added in. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

const REGEX_TESTS_KEY = 'editor.regexTests';

function loadRegexTests(): Record<string, RegexTestSet> {
  try {
    return JSON.parse(localStorage.getItem(REGEX_TESTS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
const EMPTY: MetadataDoc = {};

interface Settings {
  customValidators: string[];
  camelCase: boolean;
  theme: ThemeSetting;
}

/**
 * The editor's state, as signals: the open metadata documents, the sources, and the checks. Editing works on the
 * selected document; the checks, completion and the tester see all of them, merged as the library merges several
 * metadata maps.
 */
@Injectable({ providedIn: 'root' })
export class EditorStore {
  readonly documents = signal<MetadataDocument[]>([]);
  readonly selection = signal<Selection | undefined>(undefined);
  readonly sources = signal<ModelSource[]>([]);
  readonly settings = signal<Settings>(loadSettings());
  /**
   * Values to try against each `pattern` rule, that should pass and should fail, by rule (`Model.property`, with the
   * group and id where there are). Kept in the project file, so the team shares them; without one, for this user.
   */
  readonly regexTests = signal<Record<string, RegexTestSet>>(loadRegexTests());
  /** The path of the issue last clicked, so the JSON view can scroll to it. */
  readonly focusPath = signal<Path | undefined>(undefined);
  readonly status = signal<string>('');

  /** The selected document, which the forms and the JSON view edit. */
  readonly active = computed(() => {
    const docs = this.documents();
    return docs.find((d) => d.id === this.selection()?.docId) ?? docs[0];
  });
  readonly doc = computed(() => this.active()?.doc() ?? EMPTY);
  readonly filePath = computed(() => this.active()?.path());
  readonly jsonText = computed(() => this.active()?.jsonText() ?? '');
  readonly invalidText = computed(() => this.active()?.invalidText());
  readonly readOnly = computed(() => this.active()?.readOnly());
  /** The project (*.ivproj) in use, as last read or saved: the files and settings a team shares. */
  readonly project = signal<Project | undefined>(undefined);
  /**
   * Metadata files closed with their ✕: they leave the project when it's saved. Kept as a list rather than taking the
   * open files as the project's, so a listed file that didn't open (moved, broken) isn't dropped without a word.
   */
  private readonly closedMetadata = signal<string[]>([]);
  /**
   * What the project file would say now: its metadata files and the newly opened ones, less the ones closed, the
   * loaded sources, and the shared settings.
   */
  readonly projectState = computed<ProjectState>(() => {
    const open = this.documents().map((d) => d.path()).filter((p): p is string => !!p);
    const closed = new Set(this.closedMetadata().map((p) => p.toLowerCase()));
    return {
      metadata: unique([...(this.project()?.metadata ?? []), ...open]).filter((p) => !closed.has(p.toLowerCase())),
      sources: this.sources().map((s) => s.path),
      otherValidators: this.settings().customValidators,
      camelCase: this.settings().camelCase,
      regexTests: this.regexTests(),
    };
  });
  readonly projectDirty = computed(() => {
    const p = this.project();
    if (!p) return false;
    const s = this.projectState();
    return (
      !sameSet(s.metadata, p.metadata) ||
      !sameSet(s.sources, p.sourceFiles) ||
      !sameSet(s.otherValidators, p.otherValidators) ||
      s.camelCase !== p.camelCase ||
      stableJson(s.regexTests) !== stableJson(p.regexTests ?? {})
    );
  });

  /** Sets the values to try for a pattern rule (an empty set is removed). */
  setRegexTests(key: string, tests: RegexTestSet): void {
    const all = { ...this.regexTests() };
    const clean: RegexTestSet = {
      shouldPass: (tests.shouldPass ?? []).slice(),
      shouldFail: (tests.shouldFail ?? []).slice(),
    };
    if (clean.shouldPass.some((v) => v !== '') || clean.shouldFail.some((v) => v !== '')) all[key] = clean;
    else delete all[key];
    this.regexTests.set(all);
    if (!this.project()) localStorage.setItem(REGEX_TESTS_KEY, JSON.stringify(all));
  }

  /**
   * Moves test values to new keys when what they're keyed by changes (a model, property or group renamed, a
   * model-level rule's id changed), so they stay with their rule. `rename` returns the new key, or undefined to keep it.
   */
  moveRegexTests(rename: (key: string) => string | undefined): void {
    const all: Record<string, RegexTestSet> = {};
    let moved = false;
    for (const [key, tests] of Object.entries(this.regexTests())) {
      const next = rename(key);
      if (next !== undefined && next !== key) moved = true;
      all[next ?? key] = tests;
    }
    if (!moved) return;
    this.regexTests.set(all);
    if (!this.project()) localStorage.setItem(REGEX_TESTS_KEY, JSON.stringify(all));
  }

  /**
   * Saving a metadata file also saves its rules' test values to the project file, so they're there for the next edit.
   * Only the test values: the project's other changes (sources, settings) wait for the project's own Save.
   */
  private async saveRegexTestsToProject(): Promise<void> {
    const project = this.project();
    if (!project || stableJson(this.regexTests()) === stableJson(project.regexTests ?? {})) return;
    if (!(await this.checkBeforeWrite(project.path))) return;
    try {
      const saved = await host.writeProject(project.path, {
        metadata: project.metadata,
        sources: project.sourceFiles,
        otherValidators: project.otherValidators,
        camelCase: project.camelCase,
        regexTests: this.regexTests(),
      });
      this.project.set(saved);
      this.rememberDiskText(project.path, (await host.readFile(project.path)).text);
    } catch (e) {
      this.status.set(`Could not save the test values to the project: ${(e as Error).message}`);
    }
  }
  readonly dirty = computed(() => this.documents().some((d) => d.dirty()) || this.projectDirty());
  readonly title = computed(() => {
    const active = this.active();
    const others = this.documents().length - 1;
    return `${this.dirty() ? '● ' : ''}${active?.label() ?? 'No document'}${others > 0 ? ` (+${others})` : ''} — IdeaBlade Validation Editor`;
  });

  /** All open documents as one, as the library merges them: for looking up models and properties. */
  readonly allDocs = computed(() => this.documents().map((d) => d.doc()));
  readonly view = computed(() => (this.allDocs().length ? mergeDocs(this.allDocs()) : EMPTY));

  readonly catalog = computed(() => buildCatalog(this.sources()));
  /** The selected document's model types. */
  readonly modelTypes = computed(() => modelKeys(this.doc()));
  /** Model types in any open document. */
  readonly metadataTypes = computed(() => modelKeys(this.view()));
  /** Model types for pickers: the documents' and the sources'. */
  readonly allModelTypes = computed(() => [...new Set([...this.metadataTypes(), ...this.catalog().keys()])].sort());
  /** The application's validators and expression functions, found in the TS / C# sources. */
  readonly appValidators = computed(() => appValidators(this.sources()));
  readonly appFunctions = computed(() => appFunctions(this.sources()));
  /** Every validator the editor offers: built-in, the application's, and those named in the settings. */
  readonly validators = computed(() => validatorCatalog(this.appValidators(), this.settings().customValidators));
  readonly validatorNames = computed(() => this.validators().map((v) => v.name));
  /** Validator names besides the built-in ones, for the checks and the tester's stand-ins. */
  readonly extraValidatorNames = computed(() => [...new Set([...this.appValidators().map((v) => v.name), ...this.settings().customValidators])]);
  readonly completionEnv = computed<CompletionEnv>(() => ({ doc: this.view(), catalog: this.catalog(), functions: this.appFunctions() }));

  /** The issues of every open document. */
  readonly allIssues = computed<DocIssue[]>(() => {
    const docs = this.documents();
    const workspace = this.allDocs();
    const options = { customValidators: this.extraValidatorNames(), catalog: this.catalog(), appValidators: this.appValidators(), workspace };
    return docs.flatMap((d) => {
      const issues: Issue[] = checkDocument(d.doc(), options);
      // A model type in several documents: the library merges them, which is easy to miss.
      for (const type of modelKeys(d.doc())) {
        const others = docs.filter((o) => o !== d && isPlainObject(o.doc()[type])).map((o) => o.label());
        if (others.length) issues.push({ severity: 'info', path: [type], origin: 'library', message: `'${type}' is also in ${others.join(', ')}. The library merges them: rules are added together, and settings like extends take the last value.` });
      }
      return issues.map((i) => ({ ...i, docId: d.id }));
    });
  });
  /** The selected document's issues. */
  readonly issues = computed<Issue[]>(() => this.allIssues().filter((i) => i.docId === this.active()?.id));
  readonly errorCount = computed(() => this.allIssues().filter((i) => i.severity === 'error').length);

  constructor() {
    // A file appeared in or disappeared from one of the project's pattern folders (a new DTO, a deleted entity).
    host.onProjectFilesChanged((change) => {
      if (change.path === this.project()?.path) void this.applyProjectFiles(change.sourceFiles);
    });
    // Whichever project is in use, its pattern folders are watched; again when its patterns change.
    const watched = computed(() => {
      const p = this.project();
      return p ? `${p.path}\n${p.sources.join('\n')}` : '';
    });
    effect(() => void host.watchProject(watched() ? watched().split('\n')[0] : undefined));
    // File → Close Project only while there's one.
    effect(() => host.setProjectOpen(!!this.project()));
    // The sidebar selection is remembered for this user (with the window's place, not in the project file), once the
    // files are open and the previous one has been restored.
    effect(() => {
      const key = this.workspaceKey();
      const selection = this.selection();
      if (!this.selectionRestored() || !key || !selection) return;
      const doc = this.document(selection.docId);
      if (!doc?.path()) return;
      host.saveSelection(key, {
        path: doc.path(),
        name: doc.name(),
        kind: selection.kind,
        model: selection.kind === 'model' ? selection.name : undefined,
      });
    });
    // Every file the editor has open is watched: the sources (reloaded as they change), and the metadata files and the
    // project file (which ask first: the user may be in the middle of editing them).
    effect(() => void host.watchSources(this.watchedPaths()));
    host.onSourceChanged((change) => {
      const lower = change.path.toLowerCase();
      if (lower === this.project()?.path.toLowerCase() || this.documents().some((d) => d.path()?.toLowerCase() === lower)) {
        this.noteOutsideChange(change);
      }
      if (!this.sources().some((s) => s.path === change.path)) return;
      if (change.text !== undefined) {
        this.replaceSource(parseSource(change.path, change.text, this.settings(), change));
        this.status.set(`Reloaded ${fileName(change.path)}`);
      } else {
        this.replaceSource({ ...this.sources().find((s) => s.path === change.path)!, error: change.error, loadedAt: Date.now() });
      }
    });
  }

  // ---- Files changed outside the editor

  /** The files to watch: sources, open metadata files, the project file. */
  readonly watchedPaths = computed(() =>
    unique([
      ...this.sources().map((s) => s.path),
      ...this.documents().map((d) => d.path()).filter((p): p is string => !!p),
      ...(this.project() ? [this.project()!.path] : []),
    ]),
  );

  /**
   * Each file's text as the editor last read or wrote it. A change on disk that differs from it was made outside the
   * editor (our own saves match it), and a save checks against it so it doesn't overwrite such a change unasked.
   */
  private readonly diskTexts = new Map<string, string>();
  private rememberDiskText(path: string, text: string): void {
    this.diskTexts.set(path.toLowerCase(), text);
  }
  private diskText(path: string): string | undefined {
    return this.diskTexts.get(path.toLowerCase());
  }

  private readonly outsideChanges = new Map<string, { path: string; text?: string }>();
  private outsideTimer?: ReturnType<typeof setTimeout>;
  private askingAboutChanges = false;

  /** A metadata or project file changed on disk. Collected for a moment (a git pull changes several), then asked about. */
  private noteOutsideChange(change: { path: string; text?: string }): void {
    if (change.text !== undefined && change.text === this.diskText(change.path)) return; // our own save, or no real change
    this.outsideChanges.set(change.path.toLowerCase(), { path: change.path, text: change.text });
    clearTimeout(this.outsideTimer);
    this.outsideTimer = setTimeout(() => void this.askAboutOutsideChanges(), 600);
  }

  /** Tells the user which files changed outside the editor, and reloads them if they want. Never on its own. */
  private async askAboutOutsideChanges(): Promise<void> {
    if (this.askingAboutChanges) {
      this.outsideTimer = setTimeout(() => void this.askAboutOutsideChanges(), 600);
      return;
    }
    // Leave out what's been dealt with meanwhile (reloaded, or saved over after the save warning).
    const changes = [...this.outsideChanges.values()].filter((c) => c.text === undefined || c.text !== this.diskText(c.path));
    this.outsideChanges.clear();
    if (!changes.length) return;
    const gone = changes.filter((c) => c.text === undefined);
    const changed = changes.filter((c) => c.text !== undefined);
    if (gone.length) {
      this.status.set(`${gone.map((c) => fileName(c.path)).join(', ')} ${gone.length === 1 ? 'was' : 'were'} deleted or moved outside the editor. Saving writes ${gone.length === 1 ? 'it' : 'them'} again.`);
    }
    if (!changed.length) return;
    this.askingAboutChanges = true;
    try {
      const lines = changed.map((c) => {
        const unsaved = this.isProjectPath(c.path) ? this.projectDirty() : this.documents().some((d) => d.path()?.toLowerCase() === c.path.toLowerCase() && d.dirty());
        return `• ${fileName(c.path)}${unsaved ? ': you have unsaved changes here, which reloading discards' : ''}`;
      });
      const title = changed.length === 1 ? `${fileName(changed[0].path)} changed outside the editor` : `${changed.length} files changed outside the editor`;
      const choice = await host.confirm(
        title,
        `${lines.join('\n')}\n\nReload to see the changes. If you keep the editor's version, saving warns you before it overwrites the changes on disk.`,
        ['Reload', "Keep the editor's version"],
      );
      if (choice === 0) {
        for (const c of changed) await this.reloadFromDisk(c.path, c.text!);
        this.status.set(`Reloaded ${changed.map((c) => fileName(c.path)).join(', ')}`);
      } else {
        this.status.set(`Kept the editor's version of ${changed.map((c) => fileName(c.path)).join(', ')}`);
      }
    } finally {
      this.askingAboutChanges = false;
    }
  }

  private isProjectPath(path: string): boolean {
    return path.toLowerCase() === this.project()?.path.toLowerCase();
  }

  /** Replaces what the editor has of a file with its text on disk: a metadata file's maps, or the project. */
  async reloadFromDisk(path: string, text: string): Promise<void> {
    if (this.isProjectPath(path)) {
      let project: Project;
      try {
        project = await host.readProject(path);
      } catch (e) {
        this.status.set(`${fileName(path)} doesn't read: ${(e as Error).message}`);
        return;
      }
      this.rememberDiskText(path, text);
      this.project.set(project);
      this.closedMetadata.set([]); // reloaded: the file on disk says which metadata files are in it
      this.applyProjectSettings(project);
      this.sources.set(this.sources().filter((s) => project.sourceFiles.includes(s.path)));
      await this.loadSourcePaths(project.sourceFiles.filter((p) => !this.sources().some((s) => s.path === p)), false);
      // Metadata files the project now lists open too, as when opening it.
      for (const file of project.metadata) {
        if (!this.documents().some((d) => d.path()?.toLowerCase() === file.toLowerCase())) await this.openPath(file);
      }
      return;
    }
    const docs = this.documents();
    const old = docs.filter((d) => d.path()?.toLowerCase() === path.toLowerCase());
    if (!old.length) return;
    const fresh = await this.parseDocuments(path, text);
    this.rememberDiskText(path, text);
    const index = docs.indexOf(old[0]);
    this.documents.set([...docs.slice(0, index).filter((d) => !old.includes(d)), ...fresh, ...docs.slice(index).filter((d) => !old.includes(d))]);
    // Stay on what was selected: the same map, and the same model if it's still there.
    const selection = this.selection();
    const selectedOld = old.find((d) => d.id === selection?.docId);
    if (selection && selectedOld) {
      const match = fresh.find((d) => (d.name() ?? '') === (selectedOld.name() ?? '')) ?? fresh[0];
      if (!match) this.selection.set(this.documents()[0] ? { docId: this.documents()[0].id, kind: 'document' } : undefined);
      else if (selection.kind === 'model' && isPlainObject(match.doc()[selection.name])) this.selection.set({ docId: match.id, kind: 'model', name: selection.name });
      else this.selection.set({ docId: match.id, kind: 'document' });
    }
  }

  /**
   * Before writing a file: has it changed on disk since the editor read or wrote it? Then warn, and let the user
   * overwrite, reload instead, or cancel. True when the write may go ahead.
   */
  private async checkBeforeWrite(path: string): Promise<boolean> {
    const known = this.diskText(path);
    if (known === undefined) return true;
    let current: string;
    try {
      current = (await host.readFile(path)).text;
    } catch {
      return true; // deleted: writing creates it again
    }
    if (current === known) return true;
    const choice = await host.confirm(
      `${fileName(path)} changed outside the editor`,
      `${path}\n\nIt changed on disk after the editor read it (in another editor, another session, a git pull). Saving now overwrites those changes with the editor's version, and they're lost.`,
      ['Overwrite', 'Reload from disk', 'Cancel'],
    );
    if (choice === 0) return true;
    if (choice === 1) {
      await this.reloadFromDisk(path, current);
      this.status.set(`Reloaded ${fileName(path)}; nothing saved`);
    } else {
      this.status.set(`Didn't save ${fileName(path)}`);
    }
    return false;
  }

  validatorInfo(name: string): ValidatorInfo | undefined {
    return this.validators().find((v) => v.name === name);
  }

  document(id: string): MetadataDocument | undefined {
    return this.documents().find((d) => d.id === id);
  }

  // ---- Editing (the selected document)

  update(path: Path, value: Json | undefined): void {
    const active = this.active();
    if (!active) return;
    if (active.readOnly()) {
      this.status.set(`${active.label()} can't be edited here: ${active.readOnly()}`);
      return;
    }
    active.setDoc(setIn(active.doc(), path, value) as MetadataDoc);
  }

  get(path: Path): Json | undefined {
    return getIn(this.doc(), path);
  }

  setJsonText(text: string): void {
    const active = this.active();
    if (active && !active.readOnly()) active.setJsonText(text);
  }

  /** Edits a validator entry, turning a bare name into an object when needed and back when only the name is left. */
  updateValidator(path: Path, change: (v: ValidatorObject) => ValidatorObject): void {
    const current = this.get(path) as RuleEntry | undefined;
    const object: ValidatorObject = typeof current === 'string' ? { name: current } : { ...(current as ValidatorObject) };
    const changed = change(object);
    if (isPlainObject(changed.context) && Object.keys(changed.context).length === 0) delete changed.context;
    const keys = Object.keys(changed).filter((k) => changed[k] !== undefined);
    this.update(path, keys.length === 1 && keys[0] === 'name' ? changed.name : (changed as Json));
  }

  /** Adds a model type to a metadata file (each file has its own Add in the sidebar), and selects it. */
  addModel(name: string, docId = this.active()?.id): void {
    const doc = docId ? this.document(docId) : undefined;
    name = name.trim();
    if (!name || !doc || doc.readOnly()) return;
    this.selection.set({ docId: doc.id, kind: 'document' }); // edits go to the selected file: this one
    if (!doc.doc()[name]) this.update([name], { properties: {} });
    if (doc.doc()[name]) this.selection.set({ docId: doc.id, kind: 'model', name });
  }

  renameModel(from: string, to: string): void {
    const active = this.active();
    to = to.trim();
    if (!active || active.readOnly() || !to || to === from || active.doc()[to] !== undefined) return;
    active.setDoc(renameKey(active.doc(), from, to));
    this.selection.set({ docId: active.id, kind: 'model', name: to });
    // Test values are keyed 'Model.property', 'Model@group#id' and so on.
    this.moveRegexTests((key) => (/^[.@#]/.test(key.slice(from.length)) && key.startsWith(from) ? to + key.slice(from.length) : undefined));
  }

  removeModel(name: string): void {
    const active = this.active();
    if (!active) return;
    this.update([name], undefined);
    this.selection.set({ docId: active.id, kind: 'document' });
  }

  select(selection: Selection): void {
    this.selection.set(selection);
  }

  /** Selects what an issue is about and asks the JSON view to scroll to it. */
  focusIssue(issue: DocIssue): void {
    const first = issue.path[0];
    if (typeof first === 'string' && first !== 'global' && first !== '$comment' && first !== '$schema') {
      this.selection.set({ docId: issue.docId, kind: 'model', name: first });
    } else {
      this.selection.set({ docId: issue.docId, kind: 'document' });
    }
    this.focusPath.set([...issue.path]);
  }

  issuesAt(path: Path, exact = false): Issue[] {
    return this.issues().filter(
      (i) => (exact ? i.path.length === path.length : i.path.length >= path.length) && path.every((k, ix) => i.path[ix] === k),
    );
  }

  // ---- Opening and closing

  /**
   * A new, unsaved metadata document in the format chosen (File → New, the New button): JSON, or a map for a
   * TypeScript or C# file. Save asks where, suggesting a name in that format.
   */
  newFile(format: DocFormat = 'json'): void {
    const doc =
      format === 'json'
        ? new MetadataDocument({ doc: newDocument() })
        : new MetadataDocument({ doc: {}, format, name: format === 'ts' ? NEW_TS_NAME : 'Json' });
    this.add([doc]);
    this.status.set(`New ${FORMAT_LABELS[format]} document`);
  }

  async open(): Promise<void> {
    for (const file of await host.openFile('Open validation metadata')) await this.openText(file.path, file.text);
  }

  async openPath(path: string): Promise<void> {
    try {
      const file = await host.readFile(path);
      await this.openText(file.path, file.text);
    } catch (e) {
      this.status.set(`Could not open ${path}: ${(e as Error).message}`);
    }
  }

  private async openText(path: string, text: string): Promise<void> {
    if (fileName(path).toLowerCase().endsWith(PROJECT_EXTENSION)) {
      // Another project replaces what's open (Open…, or File → Open Recent Project); the same one stays as it is.
      if (this.project()?.path.toLowerCase() === path.toLowerCase()) {
        this.status.set(`The project ${projectLabel(path)} is already open`);
        return;
      }
      if (this.documents().length && !(await this.closeAll())) return;
      await this.openProject(path);
      return;
    }
    const open = this.documents().find((d) => d.path()?.toLowerCase() === path.toLowerCase());
    if (open) {
      this.selection.set({ docId: open.id, kind: 'document' });
      this.status.set(`${fileName(path)} is already open`);
      return;
    }
    const docs = await this.parseDocuments(path, text);
    if (!docs.length) return;
    this.rememberDiskText(path, text);
    this.add(docs);
    if (!this.status().includes("doesn't parse")) {
      this.status.set(`Opened ${fileName(path)}${docs.length > 1 ? ` (${docs.length} metadata maps)` : ''}`);
    }
    // The sources: from the project, or one found next to the file or above it; else as remembered for this file.
    if (this.project()) return;
    const projectPath = await host.findProject(path);
    if (projectPath) {
      await this.useProject(projectPath, false);
      return;
    }
    const remembered = JSON.parse(localStorage.getItem(SOURCES_KEY(path)) ?? '[]') as string[];
    const missing = remembered.filter((p) => !this.sources().some((s) => s.path === p));
    if (missing.length) await this.loadSourcePaths(missing, false);
  }

  /** A metadata file's maps, as documents: one for JSON, one per map in a TS or C# file. Empty when it has none. */
  private async parseDocuments(path: string, text: string): Promise<MetadataDocument[]> {
    const format = formatOf(path);
    if (format === 'ts') {
      const maps = await host.readTsMetadata(text, path);
      if (!maps.length) this.status.set(`${fileName(path)} has no validation metadata: the editor looks for \`const x: ModelValidationMetadataMap = { ... }\`.`);
      return maps.map((m) => new MetadataDocument({ path, format, name: m.name, doc: m.json, readOnly: m.readOnly, hasComments: m.hasComments }));
    }
    if (format === 'cs') {
      const maps = readCsMetadata(text);
      if (!maps.length) this.status.set(`${fileName(path)} has no validation metadata: the editor looks for a JSON string (a """ raw string or @"...") holding a metadata object.`);
      return maps.map((m) => new MetadataDocument({ path, format, name: m.name, doc: m.json, hasComments: m.hasComments }));
    }
    try {
      const parsed = JSON.parse(text) as Json;
      if (!isPlainObject(parsed)) throw new Error('The file is not a JSON object.');
      return [new MetadataDocument({ path, doc: parsed, text })];
    } catch (e) {
      const doc = new MetadataDocument({ path, doc: EMPTY, text });
      doc.setInvalid(text, (e as Error).message);
      this.status.set(`${fileName(path)} doesn't parse; fix it in the JSON view. ${(e as Error).message}`);
      return [doc];
    }
  }

  // ---- The project file (*.ivproj)

  /** Opens a project: its metadata files, its sources and its settings. */
  async openProject(projectPath: string): Promise<void> {
    if (!(await this.useProject(projectPath, true))) return;
    for (const file of this.project()!.metadata) {
      if (!this.documents().some((d) => d.path()?.toLowerCase() === file.toLowerCase())) await this.openPath(file);
    }
    await this.restoreSelection();
    this.status.set(`Opened the project ${projectLabel(projectPath)}`);
  }

  /** What selections are remembered by: the project file, or the first metadata file without one. */
  readonly workspaceKey = computed(() => this.project()?.path ?? this.documents()[0]?.path() ?? '');
  /** Set once the files are open and the remembered selection is back, so opening them doesn't overwrite it. */
  private readonly selectionRestored = signal(false);

  /**
   * Selects what was selected when this project (or file) was last open, if it's still there. Otherwise the first
   * model in the list, so the sidebar doesn't end on whatever file happened to open last.
   */
  async restoreSelection(): Promise<void> {
    const docs = this.documents();
    const key = this.workspaceKey();
    const saved = key ? await host.getSelection(key) : undefined;
    const doc = saved?.path
      ? docs.find((d) => d.path()?.toLowerCase() === saved.path!.toLowerCase() && (d.name() ?? '') === (saved.name ?? ''))
      : undefined;
    if (doc && saved?.kind === 'model' && saved.model && isPlainObject(doc.doc()[saved.model])) {
      this.selection.set({ docId: doc.id, kind: 'model', name: saved.model });
    } else if (doc && saved?.kind === 'document') {
      this.selection.set({ docId: doc.id, kind: 'document' });
    } else if (docs.length) {
      const first = docs[0];
      const model = modelKeys(first.doc())[0];
      this.selection.set(model ? { docId: first.id, kind: 'model', name: model } : { docId: first.id, kind: 'document' });
    }
    this.selectionRestored.set(true);
  }

  /** Takes a project's sources and settings (and remembers it as the project in use). */
  private async useProject(projectPath: string, replaceSources: boolean): Promise<boolean> {
    let project: Project;
    try {
      project = await host.readProject(projectPath);
    } catch (e) {
      this.status.set(`Could not read the project ${projectPath}: ${(e as Error).message}`);
      return false;
    }
    try {
      this.rememberDiskText(projectPath, (await host.readFile(projectPath)).text);
    } catch {
      // read a moment ago: leave the check to the next read
    }
    this.project.set(project);
    this.closedMetadata.set([]);
    this.applyProjectSettings(project);
    if (replaceSources) this.sources.set([]);
    const missing = project.sourceFiles.filter((p) => !this.sources().some((s) => s.path === p));
    await this.loadSourcePaths(missing, false);
    this.status.set(`Using the project ${projectLabel(projectPath)}`);
    return true;
  }

  private applyProjectSettings(project: Project): void {
    const settings = { ...this.settings(), customValidators: project.otherValidators, camelCase: project.camelCase };
    this.settings.set(settings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.regexTests.set(project.regexTests ?? {});
  }

  /** Saves the project file, or creates one next to the selected metadata file. */
  async saveProject(): Promise<boolean> {
    let path = this.project()?.path;
    if (!path) {
      const active = this.active()?.path();
      path = await host.chooseProjectPath(active ? active.replace(/[\\/][^\\/]*$/, '') : undefined);
      if (!path) return false;
    } else if (!(await this.checkBeforeWrite(path))) {
      return false;
    }
    try {
      this.project.set(await host.writeProject(path, this.projectState()));
      this.closedMetadata.set([]); // saved: the closed files are out of it now
      this.rememberDiskText(path, (await host.readFile(path)).text);
    } catch (e) {
      this.status.set(`Could not save the project: ${(e as Error).message}`);
      return false;
    }
    this.afterSourcesChanged(false);
    this.status.set(`Saved the project ${projectLabel(path)}`);
    return true;
  }

  private add(docs: MetadataDocument[]): void {
    if (!docs.length) return;
    this.documents.set([...this.documents(), ...docs]);
    // A closed file opened again is back in the project.
    const opened = new Set(docs.map((d) => d.path()?.toLowerCase()));
    this.closedMetadata.update((closed) => closed.filter((p) => !opened.has(p.toLowerCase())));
    const first = docs[0];
    const model = modelKeys(first.doc())[0];
    this.selection.set(model ? { docId: first.id, kind: 'model', name: model } : { docId: first.id, kind: 'document' });
  }

  async closeDocument(id = this.active()?.id): Promise<void> {
    const doc = id ? this.document(id) : undefined;
    if (!doc) return;
    if (doc.dirty()) {
      const choice = await host.confirm(`Save the changes to ${doc.label()}?`, doc.path() ?? 'Untitled', ['Save', "Don't save", 'Cancel']);
      if (choice === 2 || (choice === 0 && !(await this.save(doc)))) return;
    }
    const rest = this.documents().filter((d) => d !== doc);
    this.documents.set(rest);
    if (this.selection()?.docId === id) this.selection.set(rest[0] ? { docId: rest[0].id, kind: 'document' } : undefined);
    // Closing a file takes it out of the project (once no other map from the same TS or C# file is still open).
    const path = doc.path();
    if (path && this.project() && !rest.some((d) => d.path()?.toLowerCase() === path.toLowerCase())) {
      this.closedMetadata.update((closed) => unique([...closed, path]));
      this.status.set(`Closed ${fileName(path)}; saving the project takes it out of ${projectLabel(this.project()!.path)}`);
    }
  }

  /** Closes the project: its files and sources, after asking about unsaved changes. Nothing is open after it, nor next time. */
  async closeProject(): Promise<void> {
    const project = this.project();
    if (!project || !(await this.closeAll())) return;
    host.projectClosed();
    this.status.set(`Closed the project ${projectLabel(project.path)}`);
  }

  // ---- Saving

  /** Saves a document in its own format: the JSON file, or the map's place in its TS or C# file. */
  async save(doc = this.active()): Promise<boolean> {
    if (!doc) return false;
    if (doc.readOnly()) {
      this.status.set(`${doc.label()} can't be saved from here: ${doc.readOnly()}`);
      return false;
    }
    const path = doc.path();
    if (!path) return this.saveAs(doc);
    // Don't overwrite changes made to the file outside the editor without asking.
    if (!(await this.checkBeforeWrite(path))) return false;
    const format = doc.format();
    if (format === 'json') {
      const text = doc.invalidText()?.text ?? doc.jsonText();
      await host.saveFile(path, text);
      this.rememberDiskText(path, text);
      doc.markSaved(text);
    } else {
      if (doc.invalidText()) {
        this.status.set(`Fix the JSON of ${doc.label()} first: it doesn't parse.`);
        return false;
      }
      if (doc.hasComments()) {
        const choice = await host.confirm(
          `Comments inside ${doc.label()} will be lost`,
          'The editor rewrites the metadata object and can\'t keep comments inside it. Comments above it, and the rest of the file, stay. Use $comment to keep notes in the metadata itself.',
          ['Save anyway', 'Cancel'],
        );
        if (choice !== 0) return false;
      }
      try {
        const current = await host.readFile(path);
        const text =
          format === 'ts'
            ? await host.writeTsMetadata(current.text, path, doc.name()!, doc.doc())
            : writeCsMetadata(current.text, doc.name()!, doc.doc());
        await host.saveFile(path, text);
        this.rememberDiskText(path, text);
      } catch (e) {
        this.status.set(`Could not save ${doc.label()}: ${(e as Error).message}`);
        return false;
      }
      doc.hasComments.set(false);
      doc.markSaved();
    }
    this.afterSave(doc);
    return true;
  }

  /**
   * A TS or C# metadata file as saving would write it now: the file as last read or saved, with each of its open maps
   * (a file can hold several) that has unsaved changes written the way Save writes them. Imports, usings and the rest of
   * the file are as they are. Undefined for JSON documents.
   */
  async fileText(doc: MetadataDocument): Promise<string | undefined> {
    const path = doc.path();
    if (doc.format() === 'json') return undefined;
    // Not saved yet: the new file Save as would write, named as it suggests.
    if (!path) {
      return doc.format() === 'ts'
        ? host.newTsMetadata(NEW_TS_NAME, doc.doc())
        : newCsMetadataFile(pascalCaseFromFile(NEW_FILE_NAMES.cs), doc.doc());
    }
    let text = this.diskText(path) ?? (await host.readFile(path)).text;
    // Only maps with unsaved changes, as only those are written: the others stay exactly as they are in the file.
    const maps = this.documents().filter(
      (d) => d.path()?.toLowerCase() === path.toLowerCase() && d.dirty() && !d.readOnly() && !d.invalidText(),
    );
    for (const d of maps) {
      text = d.format() === 'ts' ? await host.writeTsMetadata(text, path, d.name()!, d.doc()) : writeCsMetadata(text, d.name()!, d.doc());
    }
    return text;
  }

  /** Saves a document to a new file; the extension picks the format: .json, .ts or .cs. */
  async saveAs(doc = this.active()): Promise<boolean> {
    if (!doc) return false;
    if (doc.invalidText()) {
      this.status.set(`Fix the JSON of ${doc.label()} first: it doesn't parse.`);
      return false;
    }
    const current = doc.path();
    const suggestion = current ?? NEW_FILE_NAMES[doc.format()];
    // A new file starts in the folder last saved to, else the project's (the main process picks).
    const projectDir = this.project()?.path.replace(/[\\/][^\\/]*$/, '');
    const path = await host.chooseSavePath(suggestion, projectDir);
    if (!path) return false;
    if (current && path.toLowerCase() === current.toLowerCase() && formatOf(path) === doc.format()) return this.save(doc);
    const format = formatOf(path);
    let text: string;
    let name: string | undefined;
    if (format === 'ts') {
      const pascal = pascalCaseFromFile(path);
      name = pascal[0].toLowerCase() + pascal.slice(1);
      text = await host.newTsMetadata(name, doc.doc());
    } else if (format === 'cs') {
      text = newCsMetadataFile(pascalCaseFromFile(path), doc.doc());
      name = 'Json';
    } else {
      text = stringify(doc.doc());
    }
    await host.saveFile(path, text);
    this.rememberDiskText(path, text);
    doc.path.set(path);
    doc.format.set(format);
    doc.name.set(name);
    doc.readOnly.set(undefined);
    doc.hasComments.set(false);
    doc.markSaved(format === 'json' ? text : undefined);
    this.afterSave(doc);
    this.rememberSources();
    return true;
  }

  async saveAll(): Promise<void> {
    for (const doc of this.documents().filter((d) => d.dirty())) {
      if (!(await this.save(doc))) return;
    }
    // After the documents, so a new file saved under its name is in the project's list.
    if (this.projectDirty()) await this.saveProject();
  }

  private afterSave(doc: MetadataDocument): void {
    const errors = this.allIssues().filter((i) => i.docId === doc.id && i.severity === 'error').length;
    this.status.set(`Saved ${doc.label()}${errors ? ` with ${errors} error${errors === 1 ? '' : 's'}` : ''}`);
    void this.saveRegexTestsToProject();
  }

  /** True when nothing is unsaved, or the user saved or discarded each document's changes. */
  /**
   * Closes every document, the project and its sources, after asking about unsaved changes (false: cancelled).
   * Before another project opens, so its files don't mix with this one's.
   */
  private async closeAll(): Promise<boolean> {
    if (!(await this.confirmDiscard())) return false;
    this.selectionRestored.set(false); // the next project's own selection comes back when it's open
    this.selection.set(undefined);
    this.documents.set([]);
    this.project.set(undefined);
    this.closedMetadata.set([]);
    this.sources.set([]);
    this.regexTests.set(loadRegexTests());
    this.diskTexts.clear();
    return true;
  }

  async confirmDiscard(): Promise<boolean> {
    for (const doc of this.documents().filter((d) => d.dirty())) {
      const choice = await host.confirm(`Save the changes to ${doc.label()}?`, doc.path() ?? 'Untitled', ['Save', "Don't save", 'Cancel']);
      if (choice === 2) return false;
      if (choice === 0 && !(await this.save(doc))) return false;
    }
    if (this.projectDirty()) {
      const project = this.project()!;
      const choice = await host.confirm('Save the changes to the project?', `${project.path}: its metadata files, sources or settings changed.`, ['Save', "Don't save", 'Cancel']);
      if (choice === 2) return false;
      if (choice === 0 && !(await this.saveProject())) return false;
    }
    return true;
  }

  // ---- Sources

  async addSources(): Promise<void> {
    const files = await host.openSources();
    for (const file of files) this.replaceSource(parseSource(file.path, file.text, this.settings(), file));
    this.afterSourcesChanged();
  }

  async loadSourcePaths(paths: string[], remember = true): Promise<void> {
    for (const path of paths) {
      try {
        const file = await host.readFile(path);
        this.replaceSource(parseSource(file.path, file.text, this.settings(), file));
      } catch (e) {
        this.replaceSource({ path, kind: 'breeze', models: [], error: (e as Error).message, loadedAt: Date.now() });
      }
    }
    this.afterSourcesChanged(remember);
  }

  async reloadSources(): Promise<void> {
    // The project's patterns again first, so files added or removed since are taken in.
    const project = this.project();
    if (project) {
      try {
        await this.applyProjectFiles((await host.readProject(project.path)).sourceFiles, false);
      } catch {
        // the project file doesn't read right now: reload what's loaded
      }
    }
    await this.loadSourcePaths(this.sources().map((s) => s.path));
    this.status.set('Reloaded the sources');
  }

  /**
   * The files the project's sources stand for now: loads the new ones and drops those that are gone. Sources added in
   * the editor and not saved to the project yet stay.
   */
  private async applyProjectFiles(sourceFiles: string[], report = true): Promise<void> {
    const project = this.project();
    if (!project) return;
    const lower = (list: string[]) => new Set(list.map((p) => p.toLowerCase()));
    const before = lower(project.sourceFiles);
    const after = lower(sourceFiles);
    const added = sourceFiles.filter((p) => !before.has(p.toLowerCase()) && !this.sources().some((s) => s.path.toLowerCase() === p.toLowerCase()));
    const removed = project.sourceFiles.filter((p) => !after.has(p.toLowerCase()));
    this.project.set({ ...project, sourceFiles });
    if (removed.length) {
      const gone = lower(removed);
      this.sources.set(this.sources().filter((s) => !gone.has(s.path.toLowerCase())));
    }
    if (added.length) await this.loadSourcePaths(added, false);
    else if (removed.length) this.afterSourcesChanged(false);
    if (report && (added.length || removed.length)) {
      const names = (list: string[]) => list.map(fileName).join(', ');
      this.status.set([added.length ? `New: ${names(added)}` : '', removed.length ? `Gone: ${names(removed)}` : ''].filter(Boolean).join(' · '));
    }
  }

  removeSource(path: string): void {
    this.sources.set(this.sources().filter((s) => s.path !== path));
    this.afterSourcesChanged();
  }

  private replaceSource(source: ModelSource): void {
    const list = this.sources();
    const index = list.findIndex((s) => s.path === source.path);
    this.sources.set(index < 0 ? [...list, source] : list.map((s, i) => (i === index ? source : s)));
  }

  private afterSourcesChanged(remember = true): void {
    // Watching follows watchedPaths (the constructor's effect); only the per-user memory needs a nudge here.
    if (remember) this.rememberSources();
  }

  /**
   * Without a project file, each open file remembers the sources for this user, so opening it again brings them back.
   * With one, the project file holds them (and shows unsaved changes instead).
   */
  private rememberSources(): void {
    if (this.project()) return;
    const paths = JSON.stringify(this.sources().map((s) => s.path));
    for (const file of new Set(this.documents().map((d) => d.path()).filter((p): p is string => !!p))) {
      localStorage.setItem(SOURCES_KEY(file), paths);
    }
  }

  // ---- Settings

  updateSettings(change: Partial<Settings>): void {
    const settings = { ...this.settings(), ...change };
    this.settings.set(settings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (change.camelCase !== undefined) void this.reloadSources();
  }
}

function loadSettings(): Settings {
  const defaults: Settings = { customValidators: [], camelCase: true, theme: 'dark' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}
