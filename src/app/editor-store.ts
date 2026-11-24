import { Injectable, computed, signal } from '@angular/core';

import { type Issue, checkDocument } from '../lib/check';
import {
  type Json,
  type MetadataDoc,
  type Path,
  type RuleEntry,
  type ValidatorObject,
  getIn,
  isPlainObject,
  modelKeys,
  newDocument,
  renameKey,
  setIn,
  stringify,
} from '../lib/doc';
import { type ValidatorInfo, validatorCatalog } from '../lib/catalog';
import type { CompletionEnv } from '../lib/completion';
import { type ModelSource, appFunctions, appValidators, buildCatalog, fileName, parseSource } from '../lib/sources';
import { host } from './host';

/** What the main area shows: the document's own settings (global rules, `$comment`) or a model type. */
export type Selection = { kind: 'document' } | { kind: 'model'; name: string };

const SETTINGS_KEY = 'editor.settings';
const SOURCES_KEY = (file: string) => `editor.sources:${file.toLowerCase()}`;

interface Settings {
  customValidators: string[];
  camelCase: boolean;
}

/**
 * The editor's state, as signals: the document, the file it came from, the model sources, and the checks. Every edit,
 * whether in the forms or the JSON view, replaces the document; everything else is computed from it.
 */
@Injectable({ providedIn: 'root' })
export class EditorStore {
  readonly doc = signal<MetadataDoc>(newDocument());
  readonly filePath = signal<string | undefined>(undefined);
  readonly selection = signal<Selection>({ kind: 'document' });
  readonly sources = signal<ModelSource[]>([]);
  readonly settings = signal<Settings>(loadSettings());
  /** The path of the issue last clicked, so the JSON view can scroll to it. */
  readonly focusPath = signal<Path | undefined>(undefined);
  readonly status = signal<string>('');

  /** The JSON text as the user typed it in the JSON view, as long as it's the current document. */
  private readonly rawText = signal<{ doc: MetadataDoc; text: string } | undefined>(undefined);
  /** JSON view text that doesn't parse (the document stays at its last valid state). */
  readonly invalidText = signal<{ text: string; error: string } | undefined>(undefined);
  private readonly savedText = signal<string>(stringify(newDocument()));

  readonly jsonText = computed(() => {
    const raw = this.rawText();
    return raw && raw.doc === this.doc() ? raw.text : stringify(this.doc());
  });
  readonly dirty = computed(() => this.jsonText() !== this.savedText() || !!this.invalidText());
  readonly title = computed(
    () => `${this.dirty() ? '● ' : ''}${this.filePath() ? fileName(this.filePath()!) : 'Untitled'} — IdeaBlade Validation Editor`,
  );

  readonly catalog = computed(() => buildCatalog(this.sources()));
  readonly modelTypes = computed(() => modelKeys(this.doc()));
  /** Model types for pickers: the document's and the model sources'. */
  readonly allModelTypes = computed(() => [...new Set([...this.modelTypes(), ...this.catalog().keys()])].sort());
  /** The application's validators and expression functions, found in the TS / C# sources. */
  readonly appValidators = computed(() => appValidators(this.sources()));
  readonly appFunctions = computed(() => appFunctions(this.sources()));
  /** Every validator the editor offers: built-in, the application's, and those named in the settings. */
  readonly validators = computed(() => validatorCatalog(this.appValidators(), this.settings().customValidators));
  readonly validatorNames = computed(() => this.validators().map((v) => v.name));
  /** Validator names besides the built-in ones, for the checks and the tester's stand-ins. */
  readonly extraValidatorNames = computed(() => [...new Set([...this.appValidators().map((v) => v.name), ...this.settings().customValidators])]);
  readonly completionEnv = computed<CompletionEnv>(() => ({ doc: this.doc(), catalog: this.catalog(), functions: this.appFunctions() }));
  readonly issues = computed<Issue[]>(() =>
    checkDocument(this.doc(), { customValidators: this.extraValidatorNames(), catalog: this.catalog(), appValidators: this.appValidators() }),
  );

  validatorInfo(name: string): ValidatorInfo | undefined {
    return this.validators().find((v) => v.name === name);
  }
  readonly errorCount = computed(() => this.issues().filter((i) => i.severity === 'error').length);

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

  // ---- Editing

  update(path: Path, value: Json | undefined): void {
    this.setDoc(setIn(this.doc(), path, value) as MetadataDoc);
  }

  get(path: Path): Json | undefined {
    return getIn(this.doc(), path);
  }

  setDoc(doc: MetadataDoc): void {
    this.invalidText.set(undefined);
    this.doc.set(doc);
  }

  /** An edit in the JSON view: applied when it parses, kept as text (with the error) when it doesn't. */
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
    name = name.trim();
    if (!name) return;
    if (!this.doc()[name]) this.update([name], { properties: {} });
    this.selection.set({ kind: 'model', name });
  }

  renameModel(from: string, to: string): void {
    to = to.trim();
    if (!to || to === from || this.doc()[to] !== undefined) return;
    this.setDoc(renameKey(this.doc(), from, to));
    this.selection.set({ kind: 'model', name: to });
  }

  removeModel(name: string): void {
    this.update([name], undefined);
    this.selection.set({ kind: 'document' });
  }

  select(selection: Selection): void {
    this.selection.set(selection);
  }

  /** Selects what an issue is about and asks the JSON view to scroll to it. */
  focusIssue(issue: Issue): void {
    const first = issue.path[0];
    if (typeof first === 'string' && first !== 'global' && first !== '$comment' && first !== '$schema') {
      this.selection.set({ kind: 'model', name: first });
    } else {
      this.selection.set({ kind: 'document' });
    }
    this.focusPath.set([...issue.path]);
  }

  issuesAt(path: Path, exact = false): Issue[] {
    return this.issues().filter(
      (i) => (exact ? i.path.length === path.length : i.path.length >= path.length) && path.every((k, ix) => i.path[ix] === k),
    );
  }

  // ---- Files

  async newFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.load(undefined, stringify(newDocument()));
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const file = await host.openFile('Open validation metadata');
    if (file) await this.openText(file.path, file.text);
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
    this.load(path, text);
    const remembered = JSON.parse(localStorage.getItem(SOURCES_KEY(path)) ?? '[]') as string[];
    if (remembered.length) await this.loadSourcePaths(remembered, false);
  }

  private load(path: string | undefined, text: string): void {
    this.filePath.set(path);
    this.savedText.set(text);
    this.rawText.set(undefined);
    this.invalidText.set(undefined);
    this.selection.set({ kind: 'document' });
    this.sources.set([]);
    void host.watchSources([]);
    try {
      const parsed = JSON.parse(text) as Json;
      if (!isPlainObject(parsed)) throw new Error('The file is not a JSON object.');
      this.rawText.set({ doc: parsed, text });
      this.doc.set(parsed);
      const first = modelKeys(parsed)[0];
      if (first) this.selection.set({ kind: 'model', name: first });
      this.status.set(path ? `Opened ${fileName(path)}` : 'New document');
    } catch (e) {
      this.doc.set(newDocument());
      this.invalidText.set({ text, error: (e as Error).message });
      this.status.set(`The file doesn't parse; fix it in the JSON view. ${(e as Error).message}`);
    }
  }

  async save(): Promise<boolean> {
    const path = this.filePath();
    if (!path) return this.saveAs();
    const text = this.textToSave();
    await host.saveFile(path, text);
    this.afterSave(path, text);
    return true;
  }

  async saveAs(): Promise<boolean> {
    const text = this.textToSave();
    const path = await host.saveFileAs(this.filePath() ?? 'validation.metadata.json', text);
    if (!path) return false;
    this.filePath.set(path);
    this.afterSave(path, text);
    this.rememberSources();
    return true;
  }

  private textToSave(): string {
    return this.invalidText()?.text ?? this.jsonText();
  }

  private afterSave(path: string, text: string): void {
    this.savedText.set(text);
    const errors = this.errorCount();
    this.status.set(`Saved ${fileName(path)}${errors ? ` with ${errors} error${errors === 1 ? '' : 's'}` : ''}`);
  }

  /** True when there are no unsaved changes, or the user saved or discarded them. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) return true;
    const choice = await host.confirm('Save the changes to the metadata?', this.filePath() ?? 'Untitled', ['Save', "Don't save", 'Cancel']);
    if (choice === 0) return this.save();
    return choice === 1;
  }

  // ---- Model sources

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
    this.status.set('Reloaded the model sources');
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

  private rememberSources(): void {
    const file = this.filePath();
    if (file) localStorage.setItem(SOURCES_KEY(file), JSON.stringify(this.sources().map((s) => s.path)));
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
  const defaults: Settings = { customValidators: [], camelCase: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}
