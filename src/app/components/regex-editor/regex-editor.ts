import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, output, untracked, viewChild, type OnDestroy } from '@angular/core';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';

import { COMMON_PATTERNS, analyzeRegex, testSamples } from '../../../lib/regex';
import { EditorStore } from '../../services/editor-store';
import { Combobox } from '../combobox/combobox';
import { type Row, split } from './matched-parts';
import { analysisField, explainOnHover, highlightField, regexSyntaxLinter, regexTheme, setAnalysis } from './regex-editor-codemirror';

/**
 * The pattern of a `pattern` rule, with what an online regex tester gives: the pieces coloured, an explanation of each
 * on hover and of the whole step by step, hints (partial matches, client/server differences), values to try that
 * should pass and should fail, and common patterns to start from. Values are tested the way the validator tests them.
 *
 * Used by the rule editor for a `regex` setting. The pattern itself goes back to the rule editor through `changed`
 * (it writes the rule); the values to try are written to the EditorStore directly (`setRegexTests`, under `testKey`),
 * since they aren't part of the metadata. The pattern is edited in a one-line CodeMirror editor.
 */
@Component({
  selector: 'app-regex-editor',
  imports: [Combobox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './regex-editor.html',
  styleUrl: './regex-editor.css',
})
export class RegexEditor implements OnDestroy {
  private readonly store = inject(EditorStore);
  /** The pattern: a regex source, or /source/flags. */
  readonly value = input<string>('');
  /** The rule's `flags` setting, which the analysis and the tests use. */
  readonly flags = input<string>('');
  /** Where the values to try are kept: one set per rule (model, property, group). */
  readonly testKey = input.required<string>();
  /** The pattern was edited (typed, a fix applied or a common pattern chosen). */
  readonly changed = output<string>();

  private readonly hostElement = viewChild.required<ElementRef<HTMLElement>>('host');
  private view?: EditorView;

  readonly common = COMMON_PATTERNS;
  /** The common patterns as menu choices, with the built-in validator that does the same next to them. */
  readonly commonOptions = COMMON_PATTERNS.map((p) => ({ value: p.label, detail: p.builtIn ? `built-in: ${p.builtIn}` : undefined }));
  readonly columns = [
    { kind: 'shouldPass' as const, title: 'Should pass', placeholder: 'values the rule must accept' },
    { kind: 'shouldFail' as const, title: 'Should fail', placeholder: 'values the rule must reject' },
  ];
  /** The pattern taken apart: pieces to colour and explain, steps, hints, and the syntax error if there is one. */
  readonly analysis = computed(() => analyzeRegex(this.value() ?? '', this.flags() ?? ''));
  /** This rule's values to try. */
  readonly tests = computed(() => this.store.regexTests()[this.testKey()] ?? { shouldPass: [], shouldFail: [] });
  /** Where the values to try are kept, so it's clear they'll be there next time (and for whom). */
  readonly whereKept = computed(() => {
    const project = this.store.project();
    if (!project) return 'Values to try are kept for you alone. Create a project file to keep them with the rule, for everyone.';
    const name = project.path.split(/[\\/]/).pop();
    return `Values to try are kept with this rule (${this.testKey()}) in ${name}, saved when you save the metadata.`;
  });
  /** When the pattern is a common one that a built-in validator also covers, a nudge to use that instead. */
  readonly commonNote = computed(() => {
    const p = this.common.find((c) => c.pattern === this.value());
    return p?.builtIn ? `The built-in ${p.builtIn} validator does this too, with its own message: prefer it.` : '';
  });

  /** Each value with whether it passes, whether that's what's expected, and the matched parts to highlight. */
  readonly results = computed(() => {
    const out = { shouldPass: [] as Row[], shouldFail: [] as Row[] };
    for (const kind of ['shouldPass', 'shouldFail'] as const) {
      const values = this.tests()[kind] ?? [];
      const results = testSamples(this.value() ?? '', this.flags() ?? '', values);
      if (!results) continue;
      out[kind] = results.map((r) => ({
        passes: r.passes,
        ok: kind === 'shouldPass' ? r.passes : !r.passes,
        parts: split(r.value, r.matches),
      }));
    }
    return out;
  });

  constructor() {
    // CodeMirror needs the host element, so it's created once the template has rendered.
    afterNextRender(() => this.create(untracked(this.value) ?? ''));
    // A pattern from elsewhere (a fix, a common pattern, the JSON view) replaces the text; our own edits come back
    // equal. Either way the editor gets the new analysis for its colours, tooltips and error.
    effect(() => {
      const value = this.value() ?? '';
      const analysis = this.analysis();
      if (!this.view) return;
      if (this.view.state.doc.toString() !== value) this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
      this.view.dispatch({ effects: setAnalysis.of(analysis) });
    });
  }

  lines(kind: 'shouldPass' | 'shouldFail'): string[] {
    return this.tests()[kind] ?? [];
  }

  /** Stores a column's values to try, one per line. */
  setLines(kind: 'shouldPass' | 'shouldFail', text: string): void {
    // Keep empty lines while typing (a new line), but not at the end.
    const lines = text.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    this.store.setRegexTests(this.testKey(), { ...this.tests(), [kind]: lines });
  }

  /** Applies a hint's fix: the fixed pattern replaces the current one. */
  apply(pattern: string): void {
    this.changed.emit(pattern);
  }

  /** Replaces the pattern with the common one chosen (the select's first option, '', is just its label). */
  useCommon(pattern: string): void {
    if (pattern) this.changed.emit(pattern);
  }

  /** A common pattern picked from the menu, by its label. */
  useCommonByLabel(label: string): void {
    const p = this.common.find((c) => c.label === label);
    if (p) this.useCommon(p.pattern);
  }

  /** Creates the one-line CodeMirror editor for the pattern in the host element. */
  private create(value: string): void {
    this.view = new EditorView({
      parent: this.hostElement().nativeElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          analysisField,
          highlightField,
          explainOnHover,
          regexSyntaxLinter(),
          keymap.of([...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap]),
          // One line: Enter doesn't add a line break to a pattern.
          EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
          placeholderExtension('e.g. ^[A-Z]{3}$'),
          // A long pattern wraps rather than scrolling sideways, so all of it stays in view.
          EditorView.lineWrapping,
          regexTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.changed.emit(update.state.doc.toString());
          }),
        ],
      }),
    });
    this.view.dispatch({ effects: setAnalysis.of(this.analysis()) });
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }
}
