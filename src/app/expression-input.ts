import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, effect, inject, input, output, untracked, viewChild, type OnDestroy } from '@angular/core';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { HighlightStyle, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { type Diagnostic, linter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { ExpressionSyntaxError, parseExpression } from 'ideablade-validation';

import { type ExpressionSite, type Member, complete, siteSummary } from '../lib/completion';
import { EditorStore } from './editor-store';

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#7c3aed' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#0f766e' },
  { tag: [tags.number, tags.bool, tags.null], color: '#b45309' },
  { tag: tags.propertyName, color: '#1d4ed8' },
  { tag: tags.variableName, color: '#1f2933' },
  { tag: tags.operator, color: '#64748b' },
]);

const COMPLETION_TYPES: Record<Member['kind'], string> = {
  variable: 'variable',
  property: 'property',
  function: 'function',
  method: 'method',
  constant: 'constant',
  keyword: 'keyword',
  type: 'class',
};

const theme = EditorView.theme({
  '&': { border: '1px solid var(--border)', borderRadius: '4px', background: 'white', fontSize: '13px' },
  '&.cm-focused': { outline: '2px solid var(--accent-soft)', borderColor: 'var(--accent)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '4px 0', fontVariantLigatures: 'none' },
  '.cm-line': { padding: '0 6px' },
  '.cm-placeholder': { color: '#9aa5b1' },
  '.cm-tooltip-autocomplete ul li': { fontFamily: 'var(--mono)', fontSize: '13px' },
  '.cm-completionDetail': { color: '#66727f', fontStyle: 'normal', marginLeft: '1em' },
  '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: '#dbe7ff' },
  '.cm-tooltip.cm-completionInfo': { maxWidth: '360px', fontSize: '13px', padding: '4px 8px' },
});

/**
 * An expression field with code completion: the variables, `context` members, model properties (also behind
 * `store('Type')` and in callbacks like `addresses.some(a => a.`), the app's own functions, the globals and the
 * methods the safe evaluator allows. Syntax errors are underlined where the parser stops.
 */
@Component({
  selector: 'app-expression-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="expression-host"></div><div class="expression-hint">{{ hint() }}</div>`,
})
export class ExpressionInput implements OnDestroy {
  private readonly store = inject(EditorStore);
  readonly value = input<string>('');
  readonly site = input.required<ExpressionSite>();
  readonly placeholder = input('');
  readonly changed = output<string>();

  private readonly hostElement = viewChild.required<ElementRef<HTMLElement>>('host');
  private view?: EditorView;

  constructor() {
    afterNextRender(() => this.create(untracked(this.value) ?? ''));
    // Changes from elsewhere (the JSON view, undo of a rename...) replace the text; our own edits come back equal.
    effect(() => {
      const value = this.value() ?? '';
      if (this.view && this.view.state.doc.toString() !== value) {
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
      }
    });
  }

  hint(): string {
    return siteSummary(this.site());
  }

  private create(value: string): void {
    const source = (context: CompletionContext) => {
      const text = context.state.doc.toString();
      const result = complete(text, context.pos, this.site(), this.store.completionEnv());
      if (!result) return null;
      // Don't pop up on every identifier character unless asked or after a dot / quote: only with a prefix typed.
      if (!context.explicit && result.from === context.pos && !/[.'"(]\s*$/.test(text.slice(0, context.pos))) return null;
      return {
        from: result.from,
        options: result.options.map(
          (m): Completion => ({
            label: m.name,
            type: COMPLETION_TYPES[m.kind],
            detail: m.detail,
            info: m.info,
            boost: m.kind === 'keyword' ? -10 : m.kind === 'type' || m.kind === 'constant' ? -5 : 0,
          }),
        ),
        validFor: /^[\w$]*$/,
      };
    };

    const syntax = linter((view): Diagnostic[] => {
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

    this.view = new EditorView({
      parent: this.hostElement().nativeElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          new LanguageSupport(javascriptLanguage),
          syntaxHighlighting(highlight),
          autocompletion({ override: [source], icons: false, activateOnTyping: true }),
          syntax,
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          placeholderExtension(this.placeholder()),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.changed.emit(update.state.doc.toString());
          }),
        ],
      }),
    });
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }
}
