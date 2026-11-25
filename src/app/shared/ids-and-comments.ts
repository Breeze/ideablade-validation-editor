// Small helpers the editor components share: ids for label/datalist pairs, and `$comment` values as text.

let nextId = 0;

/** Unique ids for `<datalist>`s. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}

/** `$comment` is a string, or an array of strings for one paragraph each: one paragraph per line in a textarea. */
export function commentText(comment: unknown): string {
  return Array.isArray(comment) ? comment.join('\n') : typeof comment === 'string' ? comment : '';
}

export function commentValue(text: string): string | string[] | undefined {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.length === 0 ? undefined : lines.length === 1 ? lines[0] : lines;
}
