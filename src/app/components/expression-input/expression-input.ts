import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, effect, inject, input, output, untracked, viewChild, type OnDestroy } from '@angular/core';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';

import { type ExpressionSite, complete, siteSummary } from '../../../lib/completion';
import { EditorStore } from '../../services/editor-store';
import { COMPLETION_TYPES, expressionHighlight, expressionSyntaxLinter, expressionTheme } from './expression-input-codemirror';

/**
 * An expression field with code completion: the variables, `context` members, model properties (also behind
 * `store('Type')` and in callbacks like `addresses.some(a => a.`), the app's own functions, the globals and the
 * methods the safe evaluator allows. Syntax errors are underlined where the parser stops.
 *
 * Used for conditions (model editor, rule editor) and an `expression` validator's expression (rule editor). It doesn't
 * write to the store itself: edits go out through `changed`, and the editor that owns the value writes it. A
 * CodeMirror editor, created once the template has rendered.
 */
@Component({
  selector: 'app-expression-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './expression-input.html',
  styleUrl: './expression-input.css',
})
export class ExpressionInput implements OnDestroy {
  private readonly store = inject(EditorStore);
  /** The expression's text. */
  readonly value = input<string>('');
  /** Where the expression is (a model's condition, a rule's condition or expression...): what completion offers. */
  readonly site = input.required<ExpressionSite>();
  /** Read once, when the editor is created. */
  readonly placeholder = input('');
  /** The text was edited. */
  readonly changed = output<string>();

  private readonly hostElement = viewChild.required<ElementRef<HTMLElement>>('host');
  private view?: EditorView;

  constructor() {
    // CodeMirror needs the host element, so it's created once the template has rendered.
    afterNextRender(() => this.create(untracked(this.value) ?? ''));
    // Changes from elsewhere (the JSON view, undo of a rename...) replace the text; our own edits come back equal.
    effect(() => {
      const value = this.value() ?? '';
      if (this.view && this.view.state.doc.toString() !== value) {
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
      }
    });
  }

  /** The line under the field: what the expression can use here. */
  hint(): string {
    return siteSummary(this.site());
  }

  /** Creates the CodeMirror editor in the host element, with completion for this site. */
  private create(value: string): void {
    // Completion reads the site and the store's completion environment (documents, model sources, the app's
    // functions) each time, so it always offers what's there now.
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

    this.view = new EditorView({
      parent: this.hostElement().nativeElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          new LanguageSupport(javascriptLanguage),
          syntaxHighlighting(expressionHighlight),
          autocompletion({ override: [source], icons: false, activateOnTyping: true }),
          expressionSyntaxLinter(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          placeholderExtension(this.placeholder()),
          expressionTheme,
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
