// The CodeMirror side of the JSON view: syntax colours, its look, the language per view, and the helpers it uses to
// keep the editor in step with the store.

import { javascript } from '@codemirror/lang-javascript';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { HighlightStyle, StreamLanguage } from '@codemirror/language';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { linter } from '@codemirror/lint';
import { Annotation, EditorState, type ChangeSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * VS Code's colours, from the theme (styles.css: --syn-*): for JSON keys, strings, numbers, true/false/null; for TS and
 * C# also keywords, types and comments.
 */
export const jsonHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.definitionKeyword, tags.controlKeyword, tags.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syn-type)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--syn-variable)' },
  { tag: tags.propertyName, color: 'var(--syn-property)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--syn-keyword)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: 'var(--syn-operator)' },
]);

/**
 * The editor's look: it fills the pane (flex: 1), in the app's theme colours. CodeMirror builds its own DOM, which
 * the component's (scoped) CSS can't reach, so its styles are here.
 */
export const jsonTheme = EditorView.theme({
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

/** What the view shows: the document as JSON (editable), or its TS or C# file as saving writes it (read-only). */
export type Shown = 'json' | 'ts' | 'cs';

/** The language extensions for what's shown: JSON also gets a linter that underlines where the parser stops. */
export function languageFor(shown: Shown) {
  if (shown === 'ts') return [javascript({ typescript: true })];
  if (shown === 'cs') return [StreamLanguage.define(csharp)];
  return [json(), linter(jsonParseLinter(), { delay: 300 })];
}

/** Marks the transactions that bring the store's text in, so they aren't sent back to it as edits. */
export const fromStore = Annotation.define<boolean>();

/** The change from `before` to `after` without what they share at the start and end, so the view keeps its place. */
export function minimalChange(before: string, after: string): ChangeSpec {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** The extensions in the view's read-only compartment, switched without recreating the editor. */
export function readOnlyExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly)];
}
