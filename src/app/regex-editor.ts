import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, output, untracked, viewChild, type OnDestroy } from '@angular/core';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { type Diagnostic, linter } from '@codemirror/lint';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap, placeholder as placeholderExtension } from '@codemirror/view';

import { COMMON_PATTERNS, type RegexAnalysis, analyzeRegex, splitPattern, testSamples } from '../lib/regex';
import { EditorStore } from './editor-store';

const theme = EditorView.theme({
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
const setAnalysis = StateEffect.define<RegexAnalysis>();
const analysisField = StateField.define<RegexAnalysis | undefined>({
  create: () => undefined,
  update: (value, tr) => tr.effects.find((e) => e.is(setAnalysis))?.value ?? value,
});

/** Where the regex starts in the editor's text: after the '/' of a '/source/flags' pattern. */
const offsetOf = (text: string) => (splitPattern(text).literal ? 1 : 0);

const highlightField = StateField.define<DecorationSet>({
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
const explainOnHover = hoverTooltip((view, pos) => {
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

/**
 * The pattern of a `pattern` rule, with what an online regex tester gives: the pieces coloured, an explanation of each
 * on hover and of the whole step by step, hints (partial matches, client/server differences), values to try that
 * should pass and should fail, and common patterns to start from. Values are tested the way the validator tests them.
 */
@Component({
  selector: 'app-regex-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="regex-input"></div>
    @if (analysis().error; as error) {
      <div class="inline-issue error">{{ error.message }} (at position {{ error.index + 1 }})</div>
    }
    @for (hint of analysis().hints; track $index) {
      <div class="inline-issue" [class]="hint.severity">
        {{ hint.message }}
        @if (hint.fix; as fix) { <button class="link" (click)="apply(fix.pattern)">{{ fix.label }}</button> }
      </div>
    }

    <div class="regex-tools">
      <select (change)="useCommon($any($event.target).value); $any($event.target).value = ''">
        <option value="">Start from a common pattern…</option>
        @for (p of common; track p.label) {
          <option [value]="p.pattern">{{ p.label }}{{ p.builtIn ? ' (built-in: ' + p.builtIn + ')' : '' }}</option>
        }
      </select>
      @if (commonNote()) { <small>{{ commonNote() }}</small> }
    </div>

    @if (analysis().steps.length) {
      <details class="regex-explain" open>
        <summary>What it matches</summary>
        <ol>
          @for (step of analysis().steps; track $index) {
            <li><code>{{ step.raw }}</code> {{ step.explanation }}</li>
          }
        </ol>
      </details>
    }

    <div class="regex-samples">
      @for (column of columns; track column.kind) {
        <div class="regex-column">
          <span class="field-label">{{ column.title }} <small>(one value per line)</small></span>
          <textarea class="code" rows="3" spellcheck="false" [value]="lines(column.kind).join('\n')" [placeholder]="column.placeholder"
            (input)="setLines(column.kind, $any($event.target).value)"></textarea>
          <div class="regex-results">
            @for (r of results()[column.kind]; track $index) {
              <div class="regex-result" [class.ok]="r.ok" [class.bad]="!r.ok" [title]="r.ok ? 'As expected' : column.kind === 'shouldPass' ? 'Should pass, but fails' : 'Should fail, but passes'">
                <span class="mark">{{ r.ok ? '✓' : '✗' }}</span>
                <code>@for (part of r.parts; track $index) {@if (part.match) {<mark>{{ part.text }}</mark>} @else {{{ part.text }}}}@if (!r.parts.length) {<em>(empty: passes, as empty values do)</em>}</code>
                <small>{{ r.passes ? 'passes' : 'fails' }}</small>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class RegexEditor implements OnDestroy {
  private readonly store = inject(EditorStore);
  readonly value = input<string>('');
  readonly flags = input<string>('');
  /** Where the values to try are kept: one set per rule (model, property, group). */
  readonly testKey = input.required<string>();
  readonly changed = output<string>();

  private readonly hostElement = viewChild.required<ElementRef<HTMLElement>>('host');
  private view?: EditorView;

  readonly common = COMMON_PATTERNS;
  readonly columns = [
    { kind: 'shouldPass' as const, title: 'Should pass', placeholder: 'values the rule must accept' },
    { kind: 'shouldFail' as const, title: 'Should fail', placeholder: 'values the rule must reject' },
  ];
  readonly analysis = computed(() => analyzeRegex(this.value() ?? '', this.flags() ?? ''));
  readonly tests = computed(() => this.store.regexTests()[this.testKey()] ?? { shouldPass: [], shouldFail: [] });
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
    afterNextRender(() => this.create(untracked(this.value) ?? ''));
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

  setLines(kind: 'shouldPass' | 'shouldFail', text: string): void {
    // Keep empty lines while typing (a new line), but not at the end.
    const lines = text.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    this.store.setRegexTests(this.testKey(), { ...this.tests(), [kind]: lines });
  }

  apply(pattern: string): void {
    this.changed.emit(pattern);
  }

  useCommon(pattern: string): void {
    if (pattern) this.changed.emit(pattern);
  }

  private create(value: string): void {
    const syntax = linter((view): Diagnostic[] => {
      const analysis = view.state.field(analysisField);
      const text = view.state.doc.toString();
      if (!analysis?.error) return [];
      const from = Math.min(analysis.error.index + offsetOf(text), text.length);
      return [{ from: Math.max(0, Math.min(from, text.length - 1)), to: Math.min(text.length, from + 1), severity: 'error', message: analysis.error.message }];
    }, { delay: 200 });

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
          syntax,
          keymap.of([...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap]),
          // One line: Enter doesn't add a line break to a pattern.
          EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
          placeholderExtension('e.g. ^[A-Z]{3}$'),
          theme,
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

interface Row {
  passes: boolean;
  ok: boolean;
  parts: { text: string; match: boolean }[];
}

function split(value: string, matches: { start: number; end: number }[]): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const m of matches) {
    if (m.start > at) parts.push({ text: value.slice(at, m.start), match: false });
    parts.push({ text: value.slice(m.start, m.end), match: true });
    at = m.end;
  }
  if (at < value.length) parts.push({ text: value.slice(at), match: false });
  return parts;
}
