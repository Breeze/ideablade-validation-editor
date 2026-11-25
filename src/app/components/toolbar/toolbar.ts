import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import type { DocFormat } from '../../services/metadata-document';
import { NEW_FORMATS } from '../../shared/new-formats';

/**
 * The toolbar across the top of the window: New (a menu of JSON, TypeScript, C#), Open, the Save commands, Discard
 * all, the source commands, and the selected file's path on the right. Each button calls the store; the same commands
 * are in the application menu (electron/window/menu.ts), which reaches the store through the shell (App).
 *
 * It's an attribute component on the `<header>` element, so the page keeps its `header.toolbar` element as before.
 */
@Component({
  selector: 'header[app-toolbar]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.css',
  host: { class: 'toolbar' },
})
export class Toolbar {
  readonly store = inject(EditorStore);
  readonly newFormats = NEW_FORMATS;
  /** Whether the New button's menu is open. */
  readonly newMenuOpen = signal(false);

  /** A choice in the New menu: a new, unsaved document in that format. */
  newFile(format: DocFormat): void {
    this.newMenuOpen.set(false);
    this.store.newFile(format);
  }

  /** Closes the New menu when focus leaves its button (after a click on a choice has gone through). */
  closeNewMenuSoon(): void {
    setTimeout(() => this.newMenuOpen.set(false), 150);
  }

  /** Save is highlighted while the selected document, or its file, has something to save. */
  saveIsPrimary(): boolean {
    const active = this.store.active();
    return !!active && (active.dirty() || this.store.removalsIn(active.path()).length > 0);
  }
}
