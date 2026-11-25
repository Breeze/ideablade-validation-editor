// The sidebar's view of the open metadata: the documents grouped by file, which files and maps are folded, and the
// search that narrows the list. The metadata search field (MetadataSearch) and the list itself (MetadataList) are two
// components in two parts of the sidebar (one pinned at the top, one scrolling), so the state they share lives here
// rather than in either of them.
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { modelKeys } from '../../lib/doc';
import { EditorStore } from './editor-store';
import { host } from './host';
import type { MetadataDocument } from './metadata-document';

/** A metadata file in the sidebar: its maps (one for JSON; one or more for TS and C#), or an unsaved document. */
export interface FileGroup {
  /** The file's path in lower case, or the document's id while it's not saved. */
  key: string;
  docs: MetadataDocument[];
}

/** How many errors and warnings the checks found in a document or a model type. */
export interface IssueCounts {
  errors: number;
  warnings: number;
}

/** A piece of a name, marked when it's the part the search matched. */
export interface NamePart {
  text: string;
  match: boolean;
}

/** The set with `key` added, or taken out if it was in it. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

@Injectable({ providedIn: 'root' })
export class MetadataTree {
  private readonly store = inject(EditorStore);

  constructor() {
    // A project (or set of files) opened, with its selection and folds back as they were: scroll the list to the
    // selection, which in a long list may be far down. Both are restored asynchronously, in either order.
    effect(() => {
      if (this.store.selectionRestored() && this.foldsLoaded() === this.store.workspaceKey()) {
        untracked(() => this.revealSelectionRequest.update((n) => n + 1));
      }
    });
    // Each project (or set of files) has its own folds, loaded when it opens; a search from the one before doesn't
    // carry over.
    effect(() => {
      const key = this.store.workspaceKey();
      untracked(() => {
        this.filter.set('');
        this.addedWhileSearching.set(new Set());
        void this.loadFolds(key);
      });
    });
  }

  // ---- The documents by file

  /** The documents by file, in their order: a TS or C# file's maps together under the file; an unsaved document alone. */
  readonly fileGroups = computed(() => {
    const groups: FileGroup[] = [];
    for (const d of this.store.documents()) {
      const key = d.path()?.toLowerCase() ?? d.id;
      const group = groups.find((g) => g.key === key);
      if (group) group.docs.push(d);
      else groups.push({ key, docs: [d] });
    }
    return groups;
  });

  /** A document's model types, in the order they're in the file. */
  modelsOf(d: MetadataDocument): string[] {
    return modelKeys(d.doc());
  }

  /** Saved TS and C# files show each map's name on a line of its own, under the file name; a JSON file is one map. */
  hasMapLines(g: FileGroup): boolean {
    return !!g.docs[0].path() && g.docs[0].format() !== 'json';
  }

  // ---- Issue counts, for the badges next to files, maps and model types

  /** Errors and warnings by model type (`docId/name`). */
  readonly modelCounts = computed(() => this.count((i) => (typeof i.path[0] === 'string' ? `${i.docId}/${i.path[0]}` : undefined)));
  /** Errors and warnings by document. */
  readonly docCounts = computed(() => this.count((i) => i.docId));

  private count(keyOf: (i: { docId: string; path: (string | number)[] }) => string | undefined): Map<string, IssueCounts> {
    const counts = new Map<string, IssueCounts>();
    for (const issue of this.store.allIssues()) {
      const key = keyOf(issue);
      if (!key) continue;
      const c = counts.get(key) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') c.errors++;
      if (issue.severity === 'warning') c.warnings++;
      counts.set(key, c);
    }
    return counts;
  }

  // ---- Folding files and maps

  /**
   * Folded files (by their key: the path in lower case) and maps (mapKey): only their name line shows. A search shows
   * its matches anyway. Kept for each project with the user's settings (window-state.json), and restored when it opens.
   */
  private readonly foldedFiles = signal<ReadonlySet<string>>(new Set());
  private readonly foldedMaps = signal<ReadonlySet<string>>(new Set());
  /** The workspace whose folds are loaded: saving waits for that, so it doesn't overwrite them with none. */
  private foldsFor: string | undefined;

  /** A map by its file and name, which stay the same from one run to the next (its id doesn't). */
  private mapKey(d: MetadataDocument): string {
    const path = d.path();
    return path ? `${path.toLowerCase()}#${d.name() ?? ''}` : d.id;
  }

  fileFolded(g: FileGroup): boolean {
    return !this.filtering() && this.foldedFiles().has(g.key);
  }

  mapFolded(d: MetadataDocument): boolean {
    return !this.filtering() && this.foldedMaps().has(this.mapKey(d));
  }

  toggleFile(g: FileGroup): void {
    this.foldedFiles.update((set) => toggled(set, g.key));
    this.saveFolds();
  }

  toggleMap(d: MetadataDocument): void {
    this.foldedMaps.update((set) => toggled(set, this.mapKey(d)));
    this.saveFolds();
  }

  /** Every file folded down to its name, and every map in them too: unfolding one file shows its maps folded. */
  collapseAll(): void {
    const groups = this.fileGroups();
    this.foldedFiles.set(new Set(groups.map((g) => g.key)));
    this.foldedMaps.set(new Set(groups.filter((g) => this.hasMapLines(g)).flatMap((g) => g.docs.map((d) => this.mapKey(d)))));
    this.saveFolds();
  }

  /** Every file and map unfolded. */
  expandAll(): void {
    this.foldedFiles.set(new Set());
    this.foldedMaps.set(new Set());
    this.saveFolds();
  }

  /** The folds this workspace had last time; none for a workspace that had none. */
  private async loadFolds(key: string): Promise<void> {
    this.foldsFor = undefined;
    this.foldsLoaded.set(undefined);
    const folds = key ? await host.getFolds(key) : undefined;
    if (this.store.workspaceKey() !== key) return; // another one opened meanwhile
    this.foldedFiles.set(new Set(folds?.files ?? []));
    this.foldedMaps.set(new Set(folds?.maps ?? []));
    this.foldsFor = key || undefined;
    this.foldsLoaded.set(key);
  }

  /** The workspace whose folds are in place (also '' for none): the list is drawn as it will stay. */
  private readonly foldsLoaded = signal<string | undefined>(undefined);

  /** Saved files and maps only: an unsaved document's id means nothing next time. */
  private saveFolds(): void {
    const key = this.store.workspaceKey();
    if (!key || this.foldsFor !== key) return;
    const saved = (set: ReadonlySet<string>) => [...set].filter((k) => !k.startsWith('doc'));
    host.saveFolds(key, { files: saved(this.foldedFiles()), maps: saved(this.foldedMaps()) });
  }

  /** Unfolds the file and the map the selection is in, so it shows. */
  private unfoldSelection(): void {
    const doc = this.store.active();
    if (!doc) return;
    const fileKey = doc.path()?.toLowerCase() ?? doc.id;
    const files = this.foldedFiles();
    const maps = this.foldedMaps();
    if (!files.has(fileKey) && !maps.has(this.mapKey(doc))) return;
    this.foldedFiles.set(new Set([...files].filter((k) => k !== fileKey)));
    this.foldedMaps.set(new Set([...maps].filter((k) => k !== this.mapKey(doc))));
    this.saveFolds();
  }

  // ---- The search: model types whose names match, and maps or files whose names match in full

  /** What's typed in the search field; empty: everything shows. */
  readonly filter = signal('');
  private readonly needle = computed(() => this.filter().trim().toLowerCase());
  readonly filtering = computed(() => this.needle() !== '');

  /**
   * Requests for the components that own the DOM: a new number asks the search field to take the focus (View → Find
   * Model Type or Map), or the list to scroll the selection into view (after the search is cleared).
   */
  readonly focusSearchRequest = signal(0);
  readonly revealSelectionRequest = signal(0);

  private hit(text: string | undefined): boolean {
    return !!text && text.toLowerCase().includes(this.needle());
  }

  /** A map shows in full when nothing is searched for, or its name or its file's name matches. */
  wholeDoc(g: FileGroup, d: MetadataDocument): boolean {
    return !this.filtering() || this.hit(g.docs[0].fileLabel()) || (this.hasMapLines(g) && this.hit(d.name()));
  }

  /** A map's model types that show: all of them, or the ones whose names match, and the ones added during this search. */
  visibleModels(g: FileGroup, d: MetadataDocument): string[] {
    const all = this.modelsOf(d);
    if (this.wholeDoc(g, d)) return all;
    const added = this.addedWhileSearching();
    return all.filter((m) => this.hit(m) || added.has(`${d.id}/${m}`));
  }

  /** Whether a map shows at all: in full, because it was added during this search, or for a model type that matches. */
  showDoc(g: FileGroup, d: MetadataDocument): boolean {
    return this.wholeDoc(g, d) || this.addedWhileSearching().has(d.id) || this.visibleModels(g, d).length > 0;
  }

  /** Whether a file shows: when one of its maps does. */
  showGroup(g: FileGroup): boolean {
    return g.docs.some((d) => this.showDoc(g, d));
  }

  /**
   * Model types (docId/name) and maps (docId) added while a search is on: they stay in view, matching or not, until
   * the search is cleared, so what you just added doesn't disappear.
   */
  private readonly addedWhileSearching = signal<ReadonlySet<string>>(new Set());

  /** Keeps something just added in view for the rest of this search (`docId/name` for a model type, `docId` for a map). */
  keepInView(key: string): void {
    if (this.filtering()) this.addedWhileSearching.update((set) => new Set([...set, key]));
  }

  /** The search field changed. Cleared: back to the whole list, with the selection unfolded and scrolled into view. */
  setFilter(value: string): void {
    this.filter.set(value);
    if (value.trim()) return;
    this.addedWhileSearching.set(new Set());
    this.unfoldSelection();
    this.revealSelectionRequest.update((n) => n + 1);
  }

  /** All model types in the open documents. */
  readonly modelTotal = computed(() => this.store.documents().reduce((n, d) => n + this.modelsOf(d).length, 0));
  /** The model types that show while searching (a matching map's or file's count in full). */
  readonly matchCount = computed(() =>
    this.fileGroups().reduce((n, g) => n + g.docs.reduce((m, d) => m + (this.showDoc(g, d) ? this.visibleModels(g, d).length : 0), 0), 0),
  );
  readonly nothingMatches = computed(() => this.filtering() && !this.fileGroups().some((g) => this.showGroup(g)));

  /** A name in pieces, the parts that match the search marked (shown highlighted in the list). */
  parts(text: string): NamePart[] {
    const needle = this.needle();
    if (!needle) return [{ text, match: false }];
    const result: NamePart[] = [];
    const lower = text.toLowerCase();
    let at = 0;
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
      if (i > at) result.push({ text: text.slice(at, i), match: false });
      result.push({ text: text.slice(i, i + needle.length), match: true });
      at = i + needle.length;
    }
    if (at < text.length) result.push({ text: text.slice(at), match: false });
    return result;
  }

  /** Enter in the search field: opens the first model type that shows, or else the first map. */
  openFirstMatch(): void {
    for (const g of this.fileGroups()) {
      for (const d of g.docs) {
        if (!this.showDoc(g, d)) continue;
        const model = this.visibleModels(g, d)[0];
        this.store.select(model ? { docId: d.id, kind: 'model', name: model } : { docId: d.id, kind: 'document' });
        return;
      }
    }
  }
}
