import { Injectable, computed, signal } from '@angular/core';

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
import { host } from './host';
import type { ThemeSetting } from './theme';

/** Where a document is kept: a JSON file, or a metadata map in a TypeScript or C# file. */
export type DocFormat = 'json' | 'ts' | 'cs';

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
  readonly dirty = computed(() => this.documents().some((d) => d.dirty()));
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
    host.onSourceChanged((change) => {
      if (!this.sources().some((s) => s.path === change.path)) return;
      if (change.text !== undefined) {
        this.replaceSource(parseSource(change.path, change.text, this.settings(), change));
        this.status.set(`Reloaded ${fileName(change.path)}`);
      } else {
        this.replaceSource({ ...this.sources().find((s) => s.path === change.path)!, error: change.error, loadedAt: Date.now() });
      }
    });
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

  addModel(name: string): void {
    const active = this.active();
    name = name.trim();
    if (!name || !active) return;
    if (!active.doc()[name]) this.update([name], { properties: {} });
    if (active.doc()[name]) this.selection.set({ docId: active.id, kind: 'model', name });
  }

  renameModel(from: string, to: string): void {
    const active = this.active();
    to = to.trim();
    if (!active || active.readOnly() || !to || to === from || active.doc()[to] !== undefined) return;
    active.setDoc(renameKey(active.doc(), from, to));
    this.selection.set({ docId: active.id, kind: 'model', name: to });
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

  newFile(): void {
    this.add([new MetadataDocument({ doc: newDocument() })]);
    this.status.set('New document');
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
    const open = this.documents().find((d) => d.path()?.toLowerCase() === path.toLowerCase());
    if (open) {
      this.selection.set({ docId: open.id, kind: 'document' });
      this.status.set(`${fileName(path)} is already open`);
      return;
    }
    const format = formatOf(path);
    let docs: MetadataDocument[];
    if (format === 'ts') {
      const maps = await host.readTsMetadata(text, path);
      docs = maps.map((m) => new MetadataDocument({ path, format, name: m.name, doc: m.json, readOnly: m.readOnly, hasComments: m.hasComments }));
      if (!docs.length) {
        this.status.set(`${fileName(path)} has no validation metadata: the editor looks for \`const x: ModelValidationMetadataMap = { ... }\`.`);
        return;
      }
    } else if (format === 'cs') {
      docs = readCsMetadata(text).map((m) => new MetadataDocument({ path, format, name: m.name, doc: m.json, hasComments: m.hasComments }));
      if (!docs.length) {
        this.status.set(`${fileName(path)} has no validation metadata: the editor looks for a JSON string (a """ raw string or @"...") holding a metadata object.`);
        return;
      }
    } else {
      const doc = new MetadataDocument({ path, doc: EMPTY, text });
      try {
        const parsed = JSON.parse(text) as Json;
        if (!isPlainObject(parsed)) throw new Error('The file is not a JSON object.');
        docs = [new MetadataDocument({ path, doc: parsed, text })];
      } catch (e) {
        doc.setInvalid(text, (e as Error).message);
        docs = [doc];
        this.status.set(`${fileName(path)} doesn't parse; fix it in the JSON view. ${(e as Error).message}`);
      }
    }
    this.add(docs);
    if (!this.status().includes("doesn't parse")) {
      this.status.set(`Opened ${fileName(path)}${docs.length > 1 ? ` (${docs.length} metadata maps)` : ''}`);
    }
    const remembered = JSON.parse(localStorage.getItem(SOURCES_KEY(path)) ?? '[]') as string[];
    const missing = remembered.filter((p) => !this.sources().some((s) => s.path === p));
    if (missing.length) await this.loadSourcePaths(missing, false);
  }

  private add(docs: MetadataDocument[]): void {
    if (!docs.length) return;
    this.documents.set([...this.documents(), ...docs]);
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
    const format = doc.format();
    if (format === 'json') {
      const text = doc.invalidText()?.text ?? doc.jsonText();
      await host.saveFile(path, text);
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

  /** Saves a document to a new file; the extension picks the format: .json, .ts or .cs. */
  async saveAs(doc = this.active()): Promise<boolean> {
    if (!doc) return false;
    if (doc.invalidText()) {
      this.status.set(`Fix the JSON of ${doc.label()} first: it doesn't parse.`);
      return false;
    }
    const current = doc.path();
    const suggestion = current ?? 'validation.metadata.json';
    const path = await host.chooseSavePath(suggestion);
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
  }

  private afterSave(doc: MetadataDocument): void {
    const errors = this.allIssues().filter((i) => i.docId === doc.id && i.severity === 'error').length;
    this.status.set(`Saved ${doc.label()}${errors ? ` with ${errors} error${errors === 1 ? '' : 's'}` : ''}`);
  }

  /** True when nothing is unsaved, or the user saved or discarded each document's changes. */
  async confirmDiscard(): Promise<boolean> {
    for (const doc of this.documents().filter((d) => d.dirty())) {
      const choice = await host.confirm(`Save the changes to ${doc.label()}?`, doc.path() ?? 'Untitled', ['Save', "Don't save", 'Cancel']);
      if (choice === 2) return false;
      if (choice === 0 && !(await this.save(doc))) return false;
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
    await this.loadSourcePaths(this.sources().map((s) => s.path));
    this.status.set('Reloaded the sources');
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
    void host.watchSources(this.sources().map((s) => s.path));
    if (remember) this.rememberSources();
  }

  /** Each open file remembers the sources, so opening it again brings them back. */
  private rememberSources(): void {
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
