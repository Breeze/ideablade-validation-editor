// The CodeMirror side of the expression input: syntax colours, completion types, its look, and the syntax check.

import { HighlightStyle } from '@codemirror/language';
import { type Diagnostic, linter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { ExpressionSyntaxError, parseExpression } from 'ideablade-validation';

import type { Member } from '../../../lib/completion';

/** Colours come from the theme (styles.css: --syn-*), so expressions look like code in VS Code in either theme. */
export const expressionHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  { tag: tags.propertyName, color: 'var(--syn-property)' },
  { tag: tags.variableName, color: 'var(--syn-variable)' },
  { tag: tags.operator, color: 'var(--syn-operator)' },
]);

/** CodeMirror's completion type (`Completion.type`) for each kind of member the completion finds. */
export const COMPLETION_TYPES: Record<Member['kind'], string> = {
  variable: 'variable',
  property: 'property',
  function: 'function',
  method: 'method',
  constant: 'constant',
  keyword: 'keyword',
  type: 'class',
};

/**
 * The editor's look (a field like the app's inputs) and the completion list's, in the app's theme colours. CodeMirror
 * builds its own DOM, which the component's (scoped) CSS can't reach, so its styles are here. (The one global rule,
 * `.cm-tooltip-autocomplete`'s rounded corners, is in styles.css.)
 */
export const expressionTheme = EditorView.theme({
  '&': { border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text)', fontSize: '13px' },
  '&.cm-focused': { outline: '2px solid var(--accent-soft)', borderColor: 'var(--accent)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '4px 0', fontVariantLigatures: 'none', caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--selection) !important' },
  '.cm-line': { padding: '0 6px' },
  '.cm-placeholder': { color: 'var(--placeholder)' },
  '.cm-tooltip': { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' },
  '.cm-tooltip-autocomplete ul li': { fontFamily: 'var(--mono)', fontSize: '13px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent)', color: 'var(--on-accent)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '1em' },
  '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: 'var(--on-accent)', opacity: '0.8' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-tooltip.cm-completionInfo': { maxWidth: '360px', fontSize: '13px', padding: '4px 8px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
});

/** Underlines where the library's expression parser stops, with its reason. One per editor. */
export function expressionSyntaxLinter() {
  return linter((view): Diagnostic[] => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];
    try {
      parseExpression(text);
      return [];
    } catch (e) {
      if (!(e instanceof ExpressionSyntaxError)) return [];
      const from = Math.min(Math.max(0, e.position), text.length);
      return [{ from, to: Math.min(text.length, from + 1), severity: 'error', message: e.reason }];
    }
  }, { delay: 300 });
}
