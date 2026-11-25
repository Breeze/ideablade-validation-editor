import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';

import { lineOfPath } from '../../../lib/doc';
import { EditorStore } from '../../services/editor-store';
import type { MetadataDocument } from '../../services/metadata-document';
import { type Shown, fromStore, jsonHighlight, jsonTheme, languageFor, minimalChange, readOnlyExtensions } from './json-view-codemirror';

/**
 * The selected document's JSON, kept in step with the forms in both directions. For a map in a TS or C# file it shows
 * that file instead, as saving would write it now (imports and the rest of the file included), with a switch to the
 * JSON, which can be edited. A code editor (CodeMirror, with its
 * JSON support): Enter indents to the level the line is at, and a `{` or `[` it splits goes on a line of its own;
 * closing brackets and quotes are added, matching brackets shown, objects and arrays fold, Ctrl+F searches, and a
 * syntax error is underlined where the parser stops. Text that doesn't parse isn't applied; the forms keep the last
 * valid state.
 *
 * Shown in the side pane, beside the forms. Edits to the JSON go to the active document through
 * `EditorStore.setJsonText`; clicking an issue (`EditorStore.focusPath`) scrolls to and selects its line.
 */
@Component({
  selector: 'app-json-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './json-view.html',
  styleUrl: './json-view.css',
})
export class JsonView implements OnDestroy {
  readonly store = inject(EditorStore);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  /** For TS and C# documents: their file (the default) or their JSON. */
  readonly mode = signal<'file' | 'json'>('file');
  /** What the editor shows now: JSON documents always show JSON; TS and C# maps show their file or their JSON. */
  readonly shown = computed<Shown>(() => {
    const format = this.store.active()?.format();
    return format === 'ts' || format === 'cs' ? (this.mode() === 'file' ? format : 'json') : 'json';
  });
  /** The TS or C# file as saving writes it, worked out a moment after each change (TS is written in the main process). */
  private readonly fileText = signal<{ docId: string; text: string } | undefined>(undefined);
  /** The text to show: the JSON (or the text that didn't parse, so it isn't lost while being fixed), or the file. */
  readonly text = computed(() => {
    if (this.shown() === 'json') return this.store.invalidText()?.text ?? this.store.jsonText();
    const file = this.fileText();
    return file && file.docId === this.store.active()?.id ? file.text : '';
  });
  /** The CodeMirror editor, once created: a signal, so the effects below run again when it appears. */
  private readonly view = signal<EditorView | undefined>(undefined);
  private readonly readOnly = new Compartment();
  /** What the editor shows (document and view): another gets a fresh editor state, so undo doesn't cross them. */
  private shownKey?: string;
  /** The issue last scrolled to, so switching views doesn't scroll to it again. */
  private handledFocus?: unknown;

  constructor() {
    // CodeMirror needs the host element, so it's created once the template has rendered.
    afterNextRender(() => {
      this.shownKey = untracked(this.key);
      this.view.set(
        new EditorView({ parent: this.host().nativeElement, state: this.createState(untracked(this.text), untracked(this.isReadOnly), untracked(this.shown)) }),
      );
    });
    // The store's text (another document, an edit in the forms, a reload) replaces what differs; our own edits come back equal.
    effect(() => {
      const view = this.view();
      if (view) this.sync(view, this.text(), this.isReadOnly());
    });
    // The file of a TS or C# document, again a moment after each change to it or to another map in the same file.
    effect((onCleanup) => {
      const doc = this.store.active();
      if (!doc || this.shown() === 'json') return;
      const siblings = this.store.documents().filter((d) => d.path() === doc.path());
      for (const d of siblings) d.doc(); // what the file depends on: its maps, and the ones removed from it
      this.store.removedMaps();
      const timer = setTimeout(() => void this.refreshFile(doc), 150);
      onCleanup(() => clearTimeout(timer));
    });
    // Scroll to, and select the line of, what the clicked issue is about, in the JSON. Only a new focus path does this,
    // not every edit or switch.
    effect(() => {
      const path = this.store.focusPath();
      const view = this.view();
      if (!path || !view || path === this.handledFocus) return;
      if (this.shown() !== 'json') {
        this.mode.set('json'); // issue paths are JSON paths; this runs again once the JSON shows
        return;
      }
      this.handledFocus = path;
      untracked(() => this.sync(view, this.text(), this.isReadOnly()));
      const doc = view.state.doc;
      const line = doc.line(Math.min(lineOfPath(doc.toString(), path) ?? 1, doc.lines));
      view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    });
  }

  /** Read-only when the document is (see MetadataDocument.readOnly) or when a TS or C# file is shown. */
  private readonly isReadOnly = computed(() => !!this.store.active()?.readOnly() || this.shown() !== 'json');
  private readonly key = computed(() => `${this.store.active()?.id}:${this.shown()}`);

  /** Asks the store for the TS or C# file as saving would write it; an error is shown as a comment in its place. */
  private async refreshFile(doc: MetadataDocument): Promise<void> {
    try {
      const text = await this.store.fileText(doc);
      if (text !== undefined) this.fileText.set({ docId: doc.id, text });
    } catch (e) {
      this.fileText.set({ docId: doc.id, text: `// ${(e as Error).message}` });
    }
  }

  /**
   * Brings the editor in line with the text: a fresh state for something else shown, else just the changed part
   * (marked fromStore and kept out of undo), and the read-only switch.
   */
  private sync(view: EditorView, text: string, readOnly: boolean): void {
    const key = this.key();
    if (key !== this.shownKey) {
      this.shownKey = key;
      view.setState(this.createState(text, readOnly, this.shown()));
      return;
    }
    const current = view.state.doc.toString();
    if (current !== text) {
      view.dispatch({ changes: minimalChange(current, text), annotations: [fromStore.of(true), Transaction.addToHistory.of(false)] });
    }
    if (view.state.readOnly !== readOnly) {
      view.dispatch({ effects: this.readOnly.reconfigure(readOnlyExtensions(readOnly)) });
    }
  }

  /** A new editor state with the text: line numbers, folding, search, the language of what's shown and so on. */
  private createState(text: string, readOnly: boolean, shown: Shown): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        ...languageFor(shown),
        syntaxHighlighting(jsonHighlight),
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        this.readOnly.of(readOnlyExtensions(readOnly)),
        jsonTheme,
        // Edits typed here (not the store's own text coming in) go to the store, for JSON only: files are read-only.
        EditorView.updateListener.of((update) => {
          if (shown === 'json' && update.docChanged && !update.transactions.some((t) => t.annotation(fromStore))) {
            this.store.setJsonText(update.state.doc.toString());
          }
        }),
      ],
    });
  }

  ngOnDestroy(): void {
    this.view()?.destroy();
  }
}
