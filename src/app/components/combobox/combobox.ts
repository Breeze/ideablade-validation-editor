import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';

/** A choice in a combobox: the text it puts in the field, and optionally a note shown next to it (a property's type). */
export interface ComboOption {
  value: string;
  detail?: string;
  /** The note is a warning (a validator not meant for the property's kind of value): shown in the warning colour. */
  warn?: boolean;
}

/** A choice that matches what's typed, with the matching parts marked for highlighting. */
interface Match {
  value: string;
  detail?: string;
  warn?: boolean;
  parts: { text: string; match: boolean }[];
}

/** At most this many choices are drawn; past that the list says how many more there are, so typing narrows it. */
const MAX_SHOWN = 200;

let nextId = 0;

/**
 * A text field with a searchable list of suggestions, for fields whose suggestions can run into the hundreds: model
 * types in a large project, `Type.property` for `from`, validator names. It replaces `<datalist>`, which only matches
 * the start of what's typed and can't be browsed.
 *
 * - Typing narrows the list: each word typed (split at spaces and dots) has to appear in a choice, in any order, so
 *   `cust name` finds `Customer.name`. Choices that start with what's typed come first. The matches are marked.
 * - ▾, Alt+↓ or ↓ shows the list (all of it while the field still holds what was there, or nothing).
 * - ↑/↓ move through it, Enter or a click puts the choice in the field, Esc closes it (a second Esc goes on to the
 *   page, e.g. to clear a search).
 * - The field stays free text: anything can be typed, as with a datalist; `valueChange` reports every change.
 *   Enter with the list closed (or nothing in it highlighted) is reported as `enter`, for fields that add something.
 * - As a `menu`, the field is only for finding a choice: picking one reports it as `picked` and empties the field
 *   (adding a property to a list, starting from a common pattern).
 * - With no choices at all, ▾ still opens the list to show `emptyText`: why there's nothing to pick.
 *
 * The list is a popover (the top layer), anchored to the field with CSS anchor positioning, so it isn't cut off by a
 * scrolling sidebar or panel and flips above the field near the bottom of the window.
 */
@Component({
  selector: 'app-combobox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './combobox.html',
  styleUrl: './combobox.css',
})
export class Combobox {
  /** The field's text. */
  readonly value = input('');
  /** The suggestions: plain strings, or values with a note. */
  readonly options = input<readonly (string | ComboOption)[]>([]);
  readonly placeholder = input('');
  /** The field's tooltip. */
  readonly title = input('');
  /** What the list says when there are no choices at all (instead of a greyed-out ▾). */
  readonly emptyText = input('');
  /** A menu: picking reports `picked` and empties the field, instead of putting the choice in it. */
  readonly menu = input(false);
  /** Every change to the field's text: typed, or a choice picked. */
  readonly valueChange = output<string>();
  /** Enter, when it doesn't pick a choice from the list: with the field's text. */
  readonly enter = output<string>();
  /** A choice picked, in a menu. */
  readonly picked = output<string>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  /** The anchor that ties the list to this field (each combobox has its own). */
  readonly anchorName = `--combo-${++nextId}`;
  readonly listId = `combo-list-${nextId}`;

  /** Whether the list is showing. */
  readonly open = signal(false);
  /** What the list is narrowed by; undefined until something is typed after opening it (all choices show). */
  private readonly filter = signal<string | undefined>(undefined);
  /** The highlighted choice, by its place in the list; -1: none. */
  readonly active = signal(-1);

  private readonly normalized = computed<ComboOption[]>(() => this.options().map((o) => (typeof o === 'string' ? { value: o } : o)));

  /** The choices that match, best first, with their matching parts. */
  readonly matches = computed<Match[]>(() => {
    const filter = this.filter()?.trim().toLowerCase() ?? '';
    const words = filter.split(/[\s.]+/).filter(Boolean);
    if (!words.length) return this.normalized().map((o) => ({ ...o, parts: [{ text: o.value, match: false }] }));
    const scored: { match: Match; rank: number; index: number }[] = [];
    this.normalized().forEach((o, index) => {
      const lower = o.value.toLowerCase();
      if (!words.every((w) => lower.includes(w))) return;
      // What starts with the typed text first, then what has a word starting with it, then the rest.
      const rank = lower.startsWith(filter) ? 0 : startsAWord(o.value, words[0]) ? 1 : 2;
      scored.push({ match: { ...o, parts: markWords(o.value, words) }, rank, index });
    });
    return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map((s) => s.match);
  });
  /** The ones drawn; the rest are counted. */
  readonly shown = computed(() => this.matches().slice(0, MAX_SHOWN));
  readonly hiddenCount = computed(() => Math.max(0, this.matches().length - MAX_SHOWN));
  readonly total = computed(() => this.options().length);
  /** Whether the list can open: there's something to pick, or a note on why there isn't. */
  readonly canOpen = computed(() => this.total() > 0 || !!this.emptyText());

  constructor() {
    // The popover follows `open`; its anchor is set on the field and the list once they exist.
    effect(() => {
      const list = this.list().nativeElement;
      const isOpen = this.open();
      if (isOpen && !list.matches(':popover-open')) list.showPopover();
      if (!isOpen && list.matches(':popover-open')) list.hidePopover();
    });
    // Keep the highlighted choice in view as it moves.
    effect(() => {
      const index = this.active();
      if (index < 0 || !this.open()) return;
      queueMicrotask(() => this.list().nativeElement.querySelectorAll<HTMLElement>('.combo-option')[index]?.scrollIntoView({ block: 'nearest' }));
    });
  }

  ngAfterViewInit(): void {
    this.field().nativeElement.style.setProperty('anchor-name', this.anchorName);
    this.list().nativeElement.style.setProperty('position-anchor', this.anchorName);
  }

  /** Typing: the text goes out, and the list opens narrowed by it. */
  onInput(text: string): void {
    if (!this.menu()) this.valueChange.emit(text);
    this.filter.set(text);
    this.active.set(text.trim() ? 0 : -1);
    this.open.set(this.canOpen());
  }

  /** ▾: shows all the choices (the current one highlighted), or closes the list. */
  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.showAll();
    this.field().nativeElement.focus();
  }

  private showAll(): void {
    this.filter.set(undefined);
    this.active.set(this.matches().findIndex((m) => m.value === this.value()));
    this.open.set(this.canOpen());
  }

  close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  /** A choice clicked or picked with Enter: into the field. */
  pick(value: string): void {
    if (this.menu()) {
      this.field().nativeElement.value = '';
      this.picked.emit(value);
    } else {
      this.valueChange.emit(value);
    }
    this.close();
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.shown().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) this.showAll();
        else if (count) this.active.set((this.active() + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (this.open() && count) this.active.set(this.active() <= 0 ? count - 1 : this.active() - 1);
        return;
      case 'Enter': {
        const chosen = this.open() ? this.shown()[this.active()] : undefined;
        if (chosen) {
          event.preventDefault();
          this.pick(chosen.value);
        } else {
          this.close();
          this.enter.emit(this.field().nativeElement.value);
        }
        return;
      }
      case 'Escape':
        if (this.open()) {
          // Only the list closes; the page doesn't see this Esc.
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
      case 'Tab':
        this.close();
        return;
    }
  }
}

/** Whether `word` is found at the start of a word in `text`: after a dot, space, _ or -, or at a capital (camelCase). */
function startsAWord(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + 1)) {
    const before = text[i - 1];
    if (i === 0 || /[.\s_-]/.test(before) || (/[A-Z]/.test(text[i]) && /[a-z]/.test(before))) return true;
  }
  return false;
}

/** The text in pieces, with every occurrence of the words marked. */
function markWords(text: string, words: string[]): { text: string; match: boolean }[] {
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) marked.fill(true, i, i + w.length);
  }
  const parts: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], match: marked[i] });
  }
  return parts;
}
