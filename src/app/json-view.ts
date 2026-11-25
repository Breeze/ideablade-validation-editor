import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, Transaction, type ChangeSpec } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { lineOfPath } from '../lib/doc';
import { EditorStore } from './editor-store';

// VS Code's JSON colours, from the theme (styles.css: --syn-*): keys, strings, numbers, true/false/null.
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syn-property)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--syn-keyword)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: 'var(--syn-operator)' },
]);

const theme = EditorView.theme({
  '&': { flex: '1', minHeight: '0', background: 'var(--bg)', color: 'var(--text)', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '19px', fontVariantLigatures: 'none' },
  '.cm-content': { caretColor: 'var(--text)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--selection) !important' },
  '.cm-gutters': { background: 'var(--bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { background: 'var(--line)' },
  '.cm-activeLineGutter': { background: 'var(--line)', color: 'var(--text)' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 4px' },
  '.cm-foldPlaceholder': { background: 'var(--line-strong)', border: 'none', color: 'var(--muted)' },
  '&.cm-focused .cm-matchingBracket': { background: 'var(--line-strong)', outline: '1px solid var(--muted)' },
  '.cm-selectionMatch': { background: 'var(--line-strong)' },
  '.cm-searchMatch': { background: 'var(--warning-soft)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch.cm-searchMatch-selected': { background: 'var(--accent-soft)' },
  // The search panel (Ctrl+F), in the app's colours. The app's own styles make inputs 100% wide and labels columns,
  // so the panel's fields, buttons and checkboxes get their sizes back here.
  '.cm-panels': { background: 'var(--panel)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { fontSize: '13px', padding: '6px 28px 6px 8px', lineHeight: '28px' },
  '.cm-panel.cm-search .cm-textfield': {
    width: '15em', fontSize: '13px', padding: '2px 6px', margin: '0 6px 0 0', verticalAlign: 'middle',
    background: 'var(--input-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px',
  },
  '.cm-panel.cm-search .cm-textfield:focus': { outline: '2px solid var(--accent-soft)', borderColor: 'var(--accent)' },
  '.cm-panel.cm-search .cm-button': {
    backgroundImage: 'none', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '4px',
    color: 'var(--text)', fontSize: '13px', padding: '1px 8px', margin: '0 4px 0 0', verticalAlign: 'middle', textTransform: 'none',
  },
  '.cm-panel.cm-search .cm-button:hover': { borderColor: 'var(--accent)' },
  '.cm-panel.cm-search label': { display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '4px', margin: '0 10px 0 4px', fontSize: '13px', color: 'var(--text)', verticalAlign: 'middle' },
  '.cm-panel.cm-search input[type=checkbox]': { width: 'auto', margin: '0' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted)', fontSize: '18px', top: '4px', right: '8px' },
  '.cm-tooltip': { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
});

/** Marks the transactions that bring the store's text in, so they aren't sent back to it as edits. */
const fromStore = Annotation.define<boolean>();

/** The change from `before` to `after` without what they share at the start and end, so the view keeps its place. */
function minimalChange(before: string, after: string): ChangeSpec {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/**
 * The selected document's JSON, kept in step with the forms in both directions. A code editor (CodeMirror, with its
 * JSON support): Enter indents to the level the line is at, and a `{` or `[` it splits goes on a line of its own;
 * closing brackets and quotes are added, matching brackets shown, objects and arrays fold, Ctrl+F searches, and a
 * syntax error is underlined where the parser stops. Text that doesn't parse isn't applied; the forms keep the last
 * valid state.
 */
@Component({
  selector: 'app-json-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.active(); as d) {
      @if (d.format() !== 'json') {
        <div class="json-note">{{ d.label() }} as JSON. It's saved as {{ d.format() === 'ts' ? 'a TypeScript object' : 'a C# JSON string' }} in {{ d.fileLabel() }}.</div>
      }
      @if (d.readOnly()) { <div class="json-note">Read-only: {{ d.readOnly() }}</div> }
    }
    <div #host class="json-host" [hidden]="!store.active()"></div>
    @if (store.invalidText(); as invalid) {
      <div class="json-error">Not applied, the JSON doesn't parse: {{ invalid.error }}</div>
    }
  `,
})
export class JsonView implements OnDestroy {
  readonly store = inject(EditorStore);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  readonly text = computed(() => this.store.invalidText()?.text ?? this.store.jsonText());
  private readonly view = signal<EditorView | undefined>(undefined);
  private readonly readOnly = new Compartment();
  /** The document the editor shows: another one gets a fresh editor state, so undo doesn't cross documents. */
  private docId?: string;

  constructor() {
    afterNextRender(() => {
      this.docId = untracked(() => this.store.active()?.id);
      this.view.set(new EditorView({ parent: this.host().nativeElement, state: this.createState(untracked(this.text), untracked(this.isReadOnly)) }));
    });
    // The store's text (another document, an edit in the forms, a reload) replaces what differs; our own edits come back equal.
    effect(() => {
      const view = this.view();
      if (view) this.sync(view, this.text(), this.isReadOnly());
    });
    // Scroll to, and select the line of, what the clicked issue is about. Only a new focus path does this, not every edit.
    effect(() => {
      const path = this.store.focusPath();
      const view = this.view();
      if (!path || !view) return;
      untracked(() => this.sync(view, this.text(), this.isReadOnly()));
      const doc = view.state.doc;
      const line = doc.line(Math.min(lineOfPath(doc.toString(), path) ?? 1, doc.lines));
      view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    });
  }

  private readonly isReadOnly = computed(() => !!this.store.active()?.readOnly());

  private sync(view: EditorView, text: string, readOnly: boolean): void {
    const id = this.store.active()?.id;
    if (id !== this.docId) {
      this.docId = id;
      view.setState(this.createState(text, readOnly));
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

  private createState(text: string, readOnly: boolean): EditorState {
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
        json(),
        syntaxHighlighting(highlight),
        linter(jsonParseLinter(), { delay: 300 }),
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        this.readOnly.of(readOnlyExtensions(readOnly)),
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((t) => t.annotation(fromStore))) {
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

function readOnlyExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly)];
}
