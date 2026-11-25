import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import { MetadataTree } from '../../services/metadata-tree';

/**
 * The Metadata heading at the top of the sidebar, with its count, Collapse all / Expand all, and the search field
 * that narrows the list below it (MetadataList) as you type. The search and the folds are MetadataTree's: this
 * component only shows them and passes the user's input on.
 */
@Component({
  selector: 'app-metadata-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './metadata-search.html',
  styleUrl: './metadata-search.css',
})
export class MetadataSearch {
  readonly store = inject(EditorStore);
  readonly tree = inject(MetadataTree);
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');

  constructor() {
    // View → Find Model Type or Map (Ctrl+Shift+F) asks for the focus through the tree.
    effect(() => {
      if (!this.tree.focusSearchRequest()) return;
      untracked(() => {
        const input = this.searchBox()?.nativeElement;
        input?.focus();
        input?.select();
      });
    });
  }

  /** Esc: clears the search; with nothing in it, leaves the field. */
  clearFilter(event: Event): void {
    if (this.tree.filter()) {
      event.preventDefault();
      this.tree.setFilter('');
    } else {
      (event.target as HTMLInputElement).blur();
    }
  }
}
