// The CodeMirror side of the regex editor: its look, and the extensions that colour the pattern's pieces, explain them
// on hover and underline a syntax error. They all work from the pattern's analysis, which the component computes and
// hands to the editor state with `setAnalysis`.

import { type Diagnostic, linter } from '@codemirror/lint';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip } from '@codemirror/view';

import { type RegexAnalysis, splitPattern } from '../../../lib/regex';

/**
 * The editor's look, in the app's theme colours. CodeMirror builds its own DOM, which the component's (scoped) CSS
 * can't reach, so its styles are here. The `rx-*` classes are the highlightField's colours for the pattern's pieces.
 */
export const regexTheme = EditorView.theme({
  '&': { border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text)', fontSize: '14px' },
  '&.cm-focused': { outline: '2px solid var(--accent-soft)', borderColor: 'var(--accent)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '5px 0', fontVariantLigatures: 'none', caretColor: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--selection) !important' },
  '.cm-line': { padding: '0 8px' },
  '.cm-placeholder': { color: 'var(--placeholder)' },
  '.cm-tooltip': { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', maxWidth: '420px' },
  '.cm-tooltip-hover': { padding: '4px 8px', fontSize: '13px' },
  '.rx-anchor': { color: 'var(--syn-keyword)', fontWeight: '700' },
  '.rx-class': { color: 'var(--syn-string)' },
  '.rx-set': { color: 'var(--syn-property)' },
  '.rx-quantifier': { color: 'var(--syn-number)', fontWeight: '700' },
  '.rx-group': { color: 'var(--accent)', fontWeight: '700' },
  '.rx-lookaround': { color: 'var(--cond-text)', fontWeight: '700' },
  '.rx-alternation': { color: 'var(--warning)', fontWeight: '700' },
  '.rx-backref': { color: 'var(--syn-property)', fontStyle: 'italic' },
});

/** The analysis of the text in the editor, kept with the editor state so decorations and tooltips can use it. */
export const setAnalysis = StateEffect.define<RegexAnalysis>();
export const analysisField = StateField.define<RegexAnalysis | undefined>({
  create: () => undefined,
  update: (value, tr) => tr.effects.find((e) => e.is(setAnalysis))?.value ?? value,
});

/** Where the regex starts in the editor's text: after the '/' of a '/source/flags' pattern. */
const offsetOf = (text: string) => (splitPattern(text).literal ? 1 : 0);

/** Colours the pattern's pieces (anchors, classes, quantifiers, groups...) with `rx-<kind>` marks, from the analysis. */
export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, tr) => {
    const analysis = tr.effects.find((e) => e.is(setAnalysis))?.value;
    if (!analysis) return decorations.map(tr.changes);
    const offset = offsetOf(tr.state.doc.toString());
    const builder = new RangeSetBuilder<Decoration>();
    const spans = [...analysis.highlights].filter((h) => h.end > h.start).sort((a, b) => a.start - b.start || a.end - b.end);
    for (const h of spans) builder.add(h.start + offset, h.end + offset, Decoration.mark({ class: `rx-${h.kind}` }));
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Hovering a piece of the pattern explains it (the innermost piece under the pointer). */
export const explainOnHover = hoverTooltip((view, pos) => {
  const analysis = view.state.field(analysisField);
  if (!analysis) return null;
  const at = pos - offsetOf(view.state.doc.toString());
  const token = analysis.tokens
    .filter((t) => t.start <= at && at < t.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!token) return null;
  const offset = offsetOf(view.state.doc.toString());
  return {
    pos: token.start + offset,
    end: token.end + offset,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = token.raw;
      dom.append(code, ' ', token.explanation);
      return { dom };
    },
  };
});

/** Underlines the character where the pattern stops parsing, with the analysis's message. One per editor. */
export function regexSyntaxLinter() {
  return linter((view): Diagnostic[] => {
    const analysis = view.state.field(analysisField);
    const text = view.state.doc.toString();
    if (!analysis?.error) return [];
    const from = Math.min(analysis.error.index + offsetOf(text), text.length);
    return [{ from: Math.max(0, Math.min(from, text.length - 1)), to: Math.min(text.length, from + 1), severity: 'error', message: analysis.error.message }];
  }, { delay: 200 });
}
