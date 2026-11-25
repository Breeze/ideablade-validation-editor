import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';

import { type TestResult, runTest, sampleFor } from '../../../lib/tester';
import { EditorStore } from '../../services/editor-store';
import { Combobox } from '../combobox/combobox';

/**
 * The "Try it" tab of the side pane: validates a sample object (JSON) of a model type with the library itself, using
 * the rules of every open document merged, as they are now (saved or not). The model type follows the one selected
 * in the editor; the sample can be filled in from the model sources, and an optional store (entities by type) feeds
 * `store('Type')` in expressions. It reads the EditorStore but doesn't edit the metadata.
 */
@Component({
  selector: 'app-tester-panel',
  imports: [Combobox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tester-panel.html',
  styleUrl: './tester-panel.css',
})
export class TesterPanel {
  readonly store = inject(EditorStore);
  /** The model type to validate the sample as. */
  readonly modelType = signal<string>('');
  /**
   * The model type field: a type the metadata has is taken (with a fresh sample, as when one is selected in the
   * editor); anything else typed there is only a search.
   */
  chooseModelType(type: string): void {
    if (type === this.modelType() || !this.store.metadataTypes().includes(type)) return;
    this.modelType.set(type);
    this.fillSample();
    this.result.set(undefined);
  }
  /** The sample object, as JSON text. */
  readonly sample = signal('{}');
  /** Entities by type for `store('Type')`, as JSON text; empty for none. */
  readonly storeText = signal('');
  /** Re-run on every change (to the metadata, the sample, the store or the settings). */
  readonly auto = signal(true);
  /** The last run's errors, or why it couldn't run (e.g. the sample isn't JSON); undefined before the first run. */
  readonly result = signal<TestResult | undefined>(undefined);

  constructor() {
    // Follow the model selected in the editor, with a fresh sample for it.
    effect(() => {
      const selection = this.store.selection();
      if (selection?.kind === 'model' && selection.name !== untracked(this.modelType)) {
        untracked(() => {
          this.modelType.set(selection.name);
          this.fillSample();
          this.result.set(undefined);
        });
      }
    });
    // With `auto` on, run again whenever anything the result depends on changes.
    effect(() => {
      this.store.allDocs();
      this.sample();
      this.storeText();
      this.store.settings();
      this.store.catalog();
      if (this.auto() && this.modelType()) untracked(() => this.run());
    });
  }

  /** Replaces the sample with one built from the model sources' properties and the metadata (see sampleFor()). */
  fillSample(): void {
    const type = this.modelType();
    this.sample.set(sampleFor(type, this.store.view(), this.store.catalog().get(type)));
  }

  /** Validates the sample. Validators the editor can't run (breeze, the app's own) are stood in for by ones that pass. */
  run(): void {
    this.result.set(
      runTest(this.store.allDocs(), this.modelType(), this.sample(), this.storeText(), this.store.extraValidatorNames(), this.store.catalog()),
    );
  }
}
