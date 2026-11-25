import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, untracked } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import { FORMAT_LABELS, type MetadataDocument } from '../../services/metadata-document';
import { type FileGroup, MetadataTree } from '../../services/metadata-tree';
import { Combobox } from '../combobox/combobox';

/** What's being dragged in the list: a model type (from a map) or a whole map (from a TS or C# file). */
type Drag = { kind: 'model'; docId: string; name: string } | { kind: 'map'; docId: string };

/**
 * The sidebar's list of metadata, in the part that scrolls: each open file (with its format, unsaved ●, error count
 * and ✕), its maps for a TS or C# file, and each map's model types. Clicking one selects it for the main area.
 *
 * Also here:
 * - adding: a "model type…" field per map, and a "map name" field per TS or C# file, first in their lists so they're
 *   at hand in a long list, and kept while searching;
 * - dragging a model type onto another map (merged if it's there too), or a map onto another file;
 * - folding files and maps, and the search's narrowing and highlighting, which come from MetadataTree.
 */
@Component({
  selector: 'app-metadata-list',
  imports: [Combobox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './metadata-list.html',
  styleUrl: './metadata-list.css',
})
export class MetadataList {
  readonly store = inject(EditorStore);
  readonly tree = inject(MetadataTree);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly formatLabels = FORMAT_LABELS;

  constructor() {
    // The search was cleared: the selection, which may have been out of the narrowed list, is scrolled back into view.
    effect(() => {
      if (!this.tree.revealSelectionRequest()) return;
      untracked(() => this.revealSelection());
    });
  }

  /** Whether a map's settings (no `model`) or one of its model types is what the main area shows. */
  isSelected(d: MetadataDocument, model?: string): boolean {
    const s = this.store.selection();
    if (!s || s.docId !== d.id || d !== this.store.active()) return false;
    return model === undefined ? s.kind === 'document' : s.kind === 'model' && s.name === model;
  }

  /** The model type a model type extends, shown next to its name. */
  extendsOf(d: MetadataDocument, name: string): string | undefined {
    const entry = d.doc()[name] as { extends?: string } | undefined;
    return typeof entry?.extends === 'string' ? entry.extends : undefined;
  }

  /** Model types the sources know that this file doesn't have yet, offered when adding one to it. */
  missingTypesOf(d: MetadataDocument): string[] {
    const have = new Set(this.tree.modelsOf(d));
    return this.store.allModelTypes().filter((t) => !have.has(t));
  }

  /** A file shows ● while one of its maps has unsaved changes, or a map removed from it isn't saved yet. */
  groupDirty(g: FileGroup): boolean {
    return g.docs.some((d) => d.dirty()) || this.store.removalsIn(g.docs[0].path()).length > 0;
  }

  /** The errors in all of a file's maps, for the badge next to its name. */
  groupErrors(g: FileGroup): number {
    return g.docs.reduce((sum, d) => sum + (this.tree.docCounts().get(d.id)?.errors ?? 0), 0);
  }

  // ---- Adding model types and maps

  /** What's typed in each map's "model type…" field, by document. */
  readonly newModels = signal<Record<string, string>>({});
  /** What's typed in each TS or C# file's "map name" field, by file. */
  readonly newMaps = signal<Record<string, string>>({});

  setNewModel(docId: string, value: string): void {
    this.newModels.update((all) => ({ ...all, [docId]: value }));
  }

  /** Adds the typed model type to the map, and keeps it in view if a search would hide it. */
  addModel(docId: string): void {
    const name = (this.newModels()[docId] ?? '').trim();
    this.store.addModel(name, docId);
    this.tree.keepInView(`${docId}/${name}`);
    this.setNewModel(docId, '');
  }

  setNewMap(key: string, value: string): void {
    this.newMaps.update((all) => ({ ...all, [key]: value }));
  }

  /** Adds a map to a TS or C# file (written there when the file is saved), and keeps it in view during a search. */
  async addMap(g: FileGroup): Promise<void> {
    if (!(await this.store.addMap(g.docs[g.docs.length - 1], this.newMaps()[g.key] ?? ''))) return;
    this.setNewMap(g.key, '');
    const added = this.store.active(); // addMap selects the new map
    if (added) this.tree.keepInView(added.id);
  }

  /** The file's ✕: closes each of its maps, asking about unsaved changes; stops at a Cancel. */
  async closeFile(g: FileGroup): Promise<void> {
    for (const d of g.docs) {
      await this.store.closeDocument(d.id);
      if (this.store.documents().includes(d)) return; // cancelled
    }
  }

  /** Scrolls the selected entry into the middle of the list, once it's drawn, if it's out of sight. */
  private revealSelection(): void {
    setTimeout(() => {
      const list = this.element.nativeElement.closest('.sidebar-list');
      const selected = list?.querySelector<HTMLElement>('.nav-item.selected, .map-head.selected');
      if (!list || !selected) return;
      const l = list.getBoundingClientRect();
      const r = selected.getBoundingClientRect();
      if (r.top < l.top || r.bottom > l.bottom) selected.scrollIntoView({ block: 'center' });
    }, 50);
  }

  // ---- Dragging model types onto maps, and maps onto files

  /** What's being dragged, and where it would land (a map's id, or a file's key): that one is outlined. */
  readonly dragging = signal<Drag | undefined>(undefined);
  readonly dropOn = signal<string | undefined>(undefined);

  dragModel(event: DragEvent, d: MetadataDocument, name: string): void {
    this.dragging.set({ kind: 'model', docId: d.id, name });
    event.dataTransfer?.setData('text/plain', name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  dragMap(event: DragEvent, d: MetadataDocument): void {
    this.dragging.set({ kind: 'map', docId: d.id });
    event.dataTransfer?.setData('text/plain', d.name() ?? '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  dragEnd(): void {
    this.dragging.set(undefined);
    this.dropOn.set(undefined);
  }

  /** Over a map's lines: a model type can be dropped there. */
  overMap(event: DragEvent, d: MetadataDocument): void {
    const drag = this.dragging();
    if (drag?.kind !== 'model' || !this.store.canMoveModel(drag.docId, drag.name, d.id)) return; // a map goes to the file
    this.accept(event, d.id);
  }

  /** Over a file: a map can be dropped there; a model type too, on a file with one map (its header). */
  overFile(event: DragEvent, g: FileGroup): void {
    const drag = this.dragging();
    if (drag?.kind === 'map' && this.store.canMoveMap(drag.docId, g.docs[0].id)) this.accept(event, g.key);
    else if (drag?.kind === 'model' && g.docs.length === 1 && this.store.canMoveModel(drag.docId, drag.name, g.docs[0].id)) this.accept(event, g.docs[0].id);
  }

  /** Lets the drop happen here (preventDefault is how a drop target says yes), and outlines the target. */
  private accept(event: DragEvent, target: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropOn.set(target);
  }

  /** Leaving a target (not just moving onto one of its children). */
  leave(event: DragEvent, target: string): void {
    const into = event.relatedTarget as Node | null;
    if (this.dropOn() === target && !(into && (event.currentTarget as HTMLElement).contains(into))) this.dropOn.set(undefined);
  }

  dropOnMap(event: DragEvent, d: MetadataDocument): void {
    const drag = this.dragging();
    if (drag?.kind !== 'model') return;
    event.preventDefault();
    event.stopPropagation();
    this.dragEnd();
    void this.store.moveModel(drag.docId, drag.name, d.id);
  }

  dropOnFile(event: DragEvent, g: FileGroup): void {
    const drag = this.dragging();
    if (!drag) return;
    event.preventDefault();
    this.dragEnd();
    if (drag.kind === 'map') void this.store.moveMap(drag.docId, g.docs[0].id);
    else if (g.docs.length === 1) void this.store.moveModel(drag.docId, drag.name, g.docs[0].id);
  }
}
