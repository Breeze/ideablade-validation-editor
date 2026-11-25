// One open metadata map (MetadataDocument), and the formats a map can be kept in: a JSON file, or a map in a
// TypeScript or C# file. The store (editor-store.ts) holds a list of these; components read their signals directly.
import { computed, signal } from '@angular/core';

import { type Json, type MetadataDoc, isPlainObject, stringify } from '../../lib/doc';
import { fileName } from '../../lib/sources';

/** Where a document is kept: a JSON file, or a metadata map in a TypeScript or C# file. */
export type DocFormat = 'json' | 'ts' | 'cs';

/** What Save as suggests for a new document, by format; the TS constant and C# class are named after the file. */
export const NEW_FILE_NAMES: Record<DocFormat, string> = {
  json: 'validation.metadata.json',
  ts: 'validation-metadata.ts',
  cs: 'ValidationMetadata.cs',
};
export const NEW_TS_NAME = 'validationMetadata';

export function formatOf(path: string): DocFormat {
  return /\.tsx?$/i.test(path) ? 'ts' : /\.cs$/i.test(path) ? 'cs' : 'json';
}

export const FORMAT_LABELS: Record<DocFormat, string> = { json: 'JSON', ts: 'TS', cs: 'C#' };

let nextId = 0;

/**
 * One open metadata map: a JSON file, or one map in a TypeScript or C# file (a file can hold several). The document
 * is the parsed JSON itself; edits replace it, and everything else is computed from it.
 */
export class MetadataDocument {
  readonly id = `doc${++nextId}`;
  readonly path = signal<string | undefined>(undefined);
  readonly format = signal<DocFormat>('json');
  /** For TS and C#: the variable or constant that holds the map in the file. */
  readonly name = signal<string | undefined>(undefined);
  readonly doc = signal<MetadataDoc>({});
  /** Why it can't be edited: a TS map with code in it, such as a spread of another map. */
  readonly readOnly = signal<string | undefined>(undefined);
  /** The TS object or C# JSON has comments inside it, which saving drops. */
  readonly hasComments = signal(false);
  /** A map added to its TS or C# file in the editor (Add map), not written into the file yet. */
  readonly newInFile = signal(false);
  /** JSON view text that doesn't parse (the document stays at its last valid state). */
  readonly invalidText = signal<{ text: string; error: string } | undefined>(undefined);
  /** The JSON as typed in the JSON view (or read from the file), as long as it's the current document. */
  private readonly rawText = signal<{ doc: MetadataDoc; text: string } | undefined>(undefined);
  /**
   * What was last saved or loaded: the file text for JSON, the formatted JSON for TS and C#. With `\n` line ends, so a
   * file with Windows line ends (`\r\n`, as git checks files out on Windows) isn't taken for changed: the JSON view
   * and the editor's own formatting use `\n`.
   */
  private readonly saved = signal('');
  /** The line ends of the JSON file as read, which saving keeps. */
  private eol: '\n' | '\r\n' = '\n';

  readonly jsonText = computed(() => {
    const raw = this.rawText();
    return raw && raw.doc === this.doc() ? raw.text : stringify(this.doc());
  });
  readonly dirty = computed(
    () =>
      this.newInFile() ||
      !!this.invalidText() ||
      (this.format() === 'json' ? withLf(this.jsonText()) : stringify(this.doc())) !== this.saved(),
  );
  readonly fileLabel = computed(() => (this.path() ? fileName(this.path()!) : 'Untitled'));
  /**
   * A saved TS or C# file shows which of its maps this is ("client.ts › clientMetadata"; a file can hold several). An
   * unsaved document is just "Untitled": its name comes from the file name Save as gives it, and the badge shows the format.
   */
  readonly label = computed(() =>
    this.path() && this.format() !== 'json' && this.name() ? `${this.fileLabel()} › ${this.name()}` : this.fileLabel(),
  );

  constructor(init: {
    path?: string;
    format?: DocFormat;
    name?: string;
    doc: MetadataDoc;
    text?: string;
    readOnly?: string;
    hasComments?: boolean;
    newInFile?: boolean;
  }) {
    this.path.set(init.path);
    this.newInFile.set(!!init.newInFile);
    this.format.set(init.format ?? 'json');
    this.name.set(init.name);
    this.doc.set(init.doc);
    this.readOnly.set(init.readOnly);
    this.hasComments.set(!!init.hasComments);
    if (init.text !== undefined && this.format() === 'json') this.rawText.set({ doc: init.doc, text: init.text });
    this.markSaved(init.text);
  }

  /** Takes the current state as saved: the file's text, for JSON, when it was just read or written. */
  markSaved(jsonFileText?: string): void {
    if (jsonFileText !== undefined) this.eol = jsonFileText.includes('\r\n') ? '\r\n' : '\n';
    this.saved.set(this.format() === 'json' ? withLf(jsonFileText ?? this.jsonText()) : stringify(this.doc()));
  }

  /** A JSON file's text as saving writes it: with the line ends the file had. */
  jsonFileText(text = this.jsonText()): string {
    const lf = withLf(text);
    return this.eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
  }

  setDoc(doc: MetadataDoc): void {
    this.invalidText.set(undefined);
    this.doc.set(doc);
  }

  setJsonText(text: string): void {
    try {
      const parsed = JSON.parse(text) as Json;
      if (!isPlainObject(parsed)) throw new Error('The metadata must be a JSON object.');
      this.invalidText.set(undefined);
      this.rawText.set({ doc: parsed, text });
      this.doc.set(parsed);
    } catch (e) {
      this.invalidText.set({ text, error: (e as Error).message });
    }
  }

  /** A JSON file that doesn't parse opens with its text in the JSON view, to be fixed there. */
  setInvalid(text: string, error: string): void {
    this.invalidText.set({ text, error });
  }
}

/** Text with `\n` line ends only. */
function withLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
