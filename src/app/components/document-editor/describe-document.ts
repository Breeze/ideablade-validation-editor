/**
 * Where and how a document is saved, for the document editor's hint: a JSON file, or a map in a TS or C# file (where
 * saving rewrites only that map, so it says so).
 */
export function describeDocument(format: string, path: string | undefined, name: string | undefined): string {
  if (!path) return 'Not saved yet. Save as… writes it as JSON, TypeScript or C#, by the extension you choose.';
  if (format === 'ts') return `The ModelValidationMetadataMap '${name}' in ${path}. Saving rewrites just that object; the rest of the file stays.`;
  if (format === 'cs') return `The JSON string '${name}' in ${path}, for AddMetadataJson. Saving rewrites just that string; the rest of the file stays.`;
  return path;
}
