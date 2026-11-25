import type { DocFormat } from '../services/metadata-document';

/** A kind of new metadata file, as offered by the toolbar's New menu and the start page (and File → New). */
export interface NewFormat {
  format: DocFormat;
  label: string;
  hint: string;
}

/** The new files the editor can start: JSON, a TypeScript map, or C# with the JSON as a constant. */
export const NEW_FORMATS: readonly NewFormat[] = [
  { format: 'json', label: 'JSON', hint: 'Ctrl+N: a validation.metadata.json file' },
  { format: 'ts', label: 'TypeScript', hint: 'A .ts file exporting a typed ModelValidationMetadataMap' },
  { format: 'cs', label: 'C#', hint: 'A .cs file with the JSON as a constant and the typed map parsed from it' },
];
