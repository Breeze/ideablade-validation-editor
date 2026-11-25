import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { type GroupEntry, type Json, type Path, type RuleEntry, isGroup, moveItem } from '../../../lib/doc';
import { regexTestKey } from '../../../lib/regex';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue, uniqueId } from '../../shared/ids-and-comments';
import { InlineIssues } from '../inline-issues/inline-issues';
import { RuleEditor } from '../rule-editor/rule-editor';
import { newRule } from './new-rule';

/**
 * A list of rules (a `validators` array): the global rules (document editor), a model's model-level rules (model
 * editor), a property's rules (property editor), or the rules of a group. Each rule gets a rule editor; a group
 * (`{ group, validators }`) is shown as a box with its name, `$comment` and a rule list of its own (groups can't nest,
 * so that one has no "Add group"). Adding, moving and removing rules and groups edits the array in the EditorStore.
 */
@Component({
  selector: 'app-rule-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleEditor],
  templateUrl: './rule-list.html',
  styleUrl: './rule-list.css',
})
export class RuleList {
  private readonly store = inject(EditorStore);
  /** Where the `validators` array is in the document. */
  readonly path = input.required<Path>();
  /** The model type the rules belong to; undefined for the global rules. */
  readonly modelType = input<string>();
  /** Set for a property's rules; undefined for model-level and global rules. */
  readonly propertyName = input<string>();
  /** True for the list inside a group, which can't have groups of its own. */
  readonly inGroup = input(false);

  readonly listId = uniqueId('validators');
  /** What's typed in the "validator…" field, until it's added. */
  readonly newName = signal('');
  /** The rules and groups, or none while the path holds no array. */
  readonly rules = computed(() => {
    const value = this.store.get(this.path());
    return (Array.isArray(value) ? value : []) as RuleEntry[];
  });
  /** Every validator the editor offers (built-in, the application's, those named in the settings), for the datalist. */
  readonly validatorNames = this.store.validatorNames;
  readonly isGroup = isGroup;
  readonly comment = (rule: GroupEntry) => commentText(rule.$comment);

  /** A path below the list, e.g. `at(2, 'validators')`. */
  at(...keys: (string | number)[]): Path {
    return [...this.path(), ...keys];
  }

  /** Adds a rule for the typed validator name at the end (see newRule()) and clears the field. */
  add(): void {
    const name = this.newName().trim();
    if (!name) return;
    this.store.update(this.path(), [...this.rules(), newRule(name)] as Json);
    this.newName.set('');
  }

  /** Adds an empty group at the end, named 'submit' (the usual reason for a group: rules checked only on submit). */
  addGroup(): void {
    this.store.update(this.path(), [...this.rules(), { group: 'submit', validators: [] }] as Json);
  }

  /** Moves the rule or group at `index` up (-1) or down (1). */
  move(index: number, delta: number): void {
    this.store.update(this.path(), moveItem(this.rules(), index, index + delta) as Json);
  }

  remove(index: number): void {
    this.store.update(this.at(index), undefined);
  }

  /** Renames a group, taking its rules' values to try (see regexTestKey()) along. */
  setGroupName(index: number, name: string): void {
    const old = (this.rules()[index] as GroupEntry).group;
    this.store.update(this.at(index, 'group'), name);
    // The group is part of its rules' test values' keys: keep them with the rules.
    const from = regexTestKey(this.modelType(), this.propertyName(), old, undefined).replace(/#$/, '');
    const to = regexTestKey(this.modelType(), this.propertyName(), name, undefined).replace(/#$/, '');
    this.store.moveRegexTests((k) => (k === from || k.startsWith(from + '#') ? to + k.slice(from.length) : undefined));
  }

  setGroupComment(index: number, text: string): void {
    this.store.update(this.at(index, '$comment'), commentValue(text));
  }
}
