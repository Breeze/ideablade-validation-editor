import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { type ModelSource, fileName } from '../../../lib/sources';
import { EditorStore } from '../../services/editor-store';
import type { PatternMatch } from '../../services/host';

/**
 * The sidebar's Sources section: where the model types, properties, validators and expression functions the forms
 * offer come from. Two kinds of entry:
 * - folders, as patterns (`client/src/app/view-models/**\/*.{ts,cs}`), one line each with their file count, folded by
 *   default (▸ shows the files); ✎ or a double-click edits the pattern, ✕ removes it with its files;
 * - files added one by one (Breeze metadata, TS, C#), each with ✕.
 * Every source is watched and read again when it changes; a folder also picks up files appearing in it. The store
 * does the reading and watching (EditorStore.sourcePatterns, sources).
 */
@Component({
  selector: 'app-sources-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sources-list.html',
  styleUrl: './sources-list.css',
})
export class SourcesList {
  readonly store = inject(EditorStore);
  readonly fileName = fileName;

  /** The sources added one by one: no pattern matches them. */
  readonly looseSources = computed(() => this.store.sources().filter((s) => !this.store.fromPattern(s.path)));

  // ---- Patterns: folded by default, the files they match under them

  /** The patterns shown unfolded. Not remembered: they start folded each time. */
  private readonly openPatterns = signal<ReadonlySet<string>>(new Set());
  /** The pattern whose text is being edited, if any. */
  readonly editingPattern = signal<string | undefined>(undefined);

  patternOpen(pattern: string): boolean {
    return this.openPatterns().has(pattern);
  }

  togglePattern(pattern: string): void {
    this.openPatterns.update((set) => {
      const next = new Set(set);
      if (!next.delete(pattern)) next.add(pattern);
      return next;
    });
  }

  /** ✎ or a double-click: the pattern becomes a text field, focused with its text selected. */
  editPattern(pattern: string): void {
    this.editingPattern.set(pattern);
    // After the field is drawn: it doesn't exist until the change above is rendered.
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.sidebar-bottom .pattern-input');
      input?.focus();
      input?.select();
    });
  }

  /** Enter or leaving the field: changes the pattern if the text changed (Esc cancels instead). */
  async commitPattern(old: string, text: string): Promise<void> {
    if (this.editingPattern() !== old) return; // Enter, then the blur it causes
    this.editingPattern.set(undefined);
    if (text.trim() && text.trim() !== this.store.patternLabel(old)) {
      // Shown unfolded again if it was.
      const index = this.store.sourcePatterns().findIndex((p) => p.pattern === old);
      if ((await this.store.changePattern(old, text)) && this.patternOpen(old)) {
        this.togglePattern(old);
        this.togglePattern(this.store.sourcePatterns()[index].pattern);
      }
    }
  }

  /** The sources a pattern matched. */
  patternSources(p: PatternMatch): ModelSource[] {
    const files = new Set(p.files.map((f) => f.toLowerCase()));
    return this.store.sources().filter((s) => files.has(s.path.toLowerCase()));
  }

  /** How many of a pattern's files didn't read (shown after its file count). */
  patternErrors(p: PatternMatch): number {
    return this.patternSources(p).filter((s) => s.error).length;
  }

  /** The badge for a source's kind. */
  kindLabel(s: ModelSource): string {
    return s.kind === 'breeze' ? 'Breeze' : s.kind === 'ts' ? 'TS' : 'C#';
  }

  /** What a source gave: "4 types · 2 validators · 1 function". */
  sourceSummary(s: ModelSource): string {
    const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    return [
      count(s.models.length, 'type'),
      s.validators?.length ? count(s.validators.length, 'validator') : '',
      s.functions?.length ? count(s.functions.length, 'function') : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** When a source was last read. */
  time(ms: number): string {
    return new Date(ms).toLocaleTimeString();
  }
}
