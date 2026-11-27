import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked, viewChildren } from '@angular/core';

import { validatorChoices } from '../../../lib/catalog';
import { type GroupEntry, type Json, type Path, type RuleEntry, isGroup, moveItem } from '../../../lib/doc';
import { regexTestKey } from '../../../lib/regex';
import { matchesWords, ruleText, searchWords } from '../../../lib/rule-search';
import { EditorStore } from '../../services/editor-store';
import { commentText, commentValue } from '../../shared/ids-and-comments';
import { Combobox } from '../combobox/combobox';
import { InlineIssues } from '../inline-issues/inline-issues';
import { RuleEditor } from '../rule-editor/rule-editor';
import { newRule } from './new-rule';

/** What a group's rules are to match while its parent list is searched: the words, and the group's own text. */
export interface RuleFilter {
  words: string[];
  context: string;
}

/** The rules in a list, those in its groups included. */
function countRules(rules: readonly RuleEntry[]): number {
  return rules.reduce((n, r) => n + (isGroup(r) ? (Array.isArray(r.validators) ? r.validators.length : 0) : 1), 0);
}

/**
 * A list of rules (a `validators` array): the global rules (document editor), a model's model-level rules (model
 * editor), a property's rules (property editor), or the rules of a group. Each rule gets a rule editor; a group
 * (`{ group, validators }`) is shown as a box with its name, `$comment` and a rule list of its own (groups can't nest,
 * so that one has no "Add group"). Adding, moving and removing rules and groups edits the array in the EditorStore.
 * A `searchable` list (the model-level and global rules) has "Find rules…" above its rules, which narrows them, and
 * its groups' rules, to those that match (see rule-search.ts).
 */
@Component({
  selector: 'app-rule-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineIssues, RuleEditor, Combobox],
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
  /** Whether the list has a search field above its rules (the model-level and global rules). */
  readonly searchable = input(false);
  /** For a group's list while its parent list is searched: what the group's rules are to match. */
  readonly filter = input<RuleFilter>();
  /** A rule or group was added here or in a group, which ends the search (it would most likely hide it). */
  readonly added = output<void>();

  /** What's typed in the "validator…" field, until it's added. */
  readonly newName = signal('');
  /** What's typed in "Find rules…". */
  readonly query = signal('');
  private readonly ruleEditors = viewChildren(RuleEditor);
  private readonly groupLists = viewChildren(RuleList);

  constructor() {
    // Another model type in the same editor: start it without a search.
    effect(() => {
      this.modelType();
      untracked(() => this.query.set(''));
    });
  }

  /** The rules and groups, or none while the path holds no array. */
  readonly rules = computed(() => {
    const value = this.store.get(this.path());
    return (Array.isArray(value) ? value : []) as RuleEntry[];
  });
  /** The words searched for (this list's own search, or its parent's) and what they may also match, a group's name. */
  private readonly search = computed<RuleFilter>(() =>
    this.searchable() ? { words: searchWords(this.query()), context: '' } : (this.filter() ?? { words: [], context: '' }),
  );
  readonly filtering = computed(() => this.search().words.length > 0);
  /**
   * The rules and groups that show, with their index in the array: all of them, or while searching the rules whose
   * text (see ruleText()), with their group's name, has every word, and the groups that have such rules (with a
   * filter for their own list) or whose name or $comment has them all (shown in full).
   */
  readonly items = computed(() => {
    const { words, context } = this.search();
    const all = this.rules().map((rule, index) => ({ rule, index, filter: undefined as RuleFilter | undefined }));
    if (!words.length) return all;
    return all.filter((item) => {
      const text = context + '\n' + ruleText(item.rule);
      if (matchesWords(text, words)) return true;
      if (!isGroup(item.rule) || !Array.isArray(item.rule.validators)) return false;
      item.filter = { words, context: text };
      return item.rule.validators.some((r) => matchesWords(text + '\n' + ruleText(r), words));
    });
  });
  /** The number of rules, those in groups included (for the search's "3 of 12"). */
  readonly ruleCount = computed(() => countRules(this.rules()));
  /** The number of rules that show while searching. */
  readonly matchCount = computed(() => {
    const { words } = this.search();
    return this.items().reduce((n, item) => {
      if (!isGroup(item.rule)) return n + 1;
      const rules = Array.isArray(item.rule.validators) ? item.rule.validators : [];
      if (!item.filter) return n + countRules(rules);
      return n + rules.filter((r) => matchesWords(item.filter!.context + '\n' + ruleText(r), words)).length;
    }, 0);
  });
  /** Every validator the editor offers (built-in, the application's, those named in the settings), for the "validator…" field. */
  readonly validatorNames = this.store.validatorNames;
  /** The validators as choices: what each is for, and ⚠ on those not meant for this property's kind of value. */
  readonly validatorChoices = computed(() => validatorChoices(this.store.validators(), this.store.propertyKind(this.modelType(), this.propertyName())));
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
    this.afterAdd();
  }

  /** Adds an empty group at the end, named 'submit' (the usual reason for a group: rules checked only on submit). */
  addGroup(): void {
    this.store.update(this.path(), [...this.rules(), { group: 'submit', validators: [] }] as Json);
    this.afterAdd();
  }

  /** Something was added here or in a group: ends the search, which would most likely hide it. */
  afterAdd(): void {
    this.query.set('');
    this.added.emit();
  }

  /** Enter in the search: unfolds the first rule that matches (in a group, if that comes first). */
  openFirst(): boolean {
    // A group's list unfiltered is a group whose own name matched: its first rule is the match.
    if (!this.filtering() && !this.inGroup()) return false;
    for (const item of this.items()) {
      if (isGroup(item.rule)) {
        const list = this.groupLists().find((l) => l.path()[l.path().length - 2] === item.index);
        if (list?.openFirst()) return true;
      } else {
        const editor = this.ruleEditors().find((e) => e.path()[e.path().length - 1] === item.index);
        if (editor) {
          editor.open.set(true);
          return true;
        }
      }
    }
    return false;
  }

  /** Esc in the search: clears it; with nothing in it, leaves the field. */
  clearSearch(event: Event): void {
    if (this.query()) {
      event.preventDefault();
      this.query.set('');
    } else {
      (event.target as HTMLInputElement).blur();
    }
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
