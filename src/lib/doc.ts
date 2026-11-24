// The metadata document as the editor holds it: the parsed JSON itself, so that `$schema`, `$comment`, key order and
// anything the forms don't know about survive a round trip. All updates are immutable (structural sharing), so React
// can compare by reference.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Comment = string | string[];

export interface ValidatorObject {
  name: string;
  id?: string;
  async?: boolean;
  condition?: string;
  propertyNames?: string[];
  context?: JsonObject;
  $comment?: Comment;
  [key: string]: unknown;
}

export type ValidatorEntry = string | ValidatorObject;

export interface GroupEntry {
  group: string;
  validators: ValidatorEntry[];
  $comment?: Comment;
  [key: string]: unknown;
}

export type RuleEntry = ValidatorEntry | GroupEntry;

export interface PropertyEntry {
  from?: string;
  displayName?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  validators?: RuleEntry[];
  $comment?: Comment;
  [key: string]: unknown;
}

export interface ModelEntry {
  extends?: string;
  condition?: string;
  validators?: RuleEntry[];
  properties?: { [name: string]: PropertyEntry };
  $comment?: Comment;
  [key: string]: unknown;
}

export type MetadataDoc = JsonObject;

/** A path into the document, as keys and array indexes. */
export type Path = (string | number)[];

export const SPECIAL_KEYS = ['$schema', '$comment', 'global'];

export const DEFAULT_SCHEMA_URL =
  'https://raw.githubusercontent.com/Breeze/ideablade-validation/main/spec/validation-metadata.schema.json';

export function newDocument(): MetadataDoc {
  return { $schema: DEFAULT_SCHEMA_URL, global: { validators: [] } };
}

export function isModelKey(key: string): boolean {
  return !SPECIAL_KEYS.includes(key);
}

export function modelKeys(doc: MetadataDoc): string[] {
  return Object.keys(doc).filter(isModelKey);
}

export function isGroup(rule: RuleEntry | Json): rule is GroupEntry {
  return typeof rule === 'object' && rule !== null && !Array.isArray(rule) && 'group' in rule;
}

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validatorName(rule: ValidatorEntry): string {
  return typeof rule === 'string' ? rule : rule.name;
}

export function getIn(doc: Json | undefined, path: Path): Json | undefined {
  let current: Json | undefined = doc;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, Json>)[key as never];
  }
  return current;
}

/**
 * Sets a value at a path, creating objects on the way. `undefined` removes the key (or array item). Objects that end
 * up empty are kept: an empty `properties` or `context` is harmless and is what the user just made.
 */
export function setIn(doc: Json | undefined, path: Path, value: Json | undefined): Json {
  if (path.length === 0) return value ?? null;
  const [key, ...rest] = path;
  if (typeof key === 'number') {
    const array = Array.isArray(doc) ? [...doc] : [];
    if (rest.length === 0 && value === undefined) {
      array.splice(key, 1);
    } else {
      array[key] = setIn(array[key], rest, value);
    }
    return array;
  }
  const object: JsonObject = isPlainObject(doc) ? { ...doc } : {};
  if (rest.length === 0 && value === undefined) {
    delete object[key];
  } else {
    object[key] = setIn(object[key], rest, value);
  }
  return object;
}

/** Renames a key in an object, keeping its position. */
export function renameKey(object: JsonObject, from: string, to: string): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(object)) {
    result[key === from ? to : key] = value;
  }
  return result;
}

export function moveItem<T>(array: readonly T[], from: number, to: number): T[] {
  const copy = [...array];
  if (to < 0 || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Formats the document the way the TempHire file is formatted: two-space JSON with a trailing newline. */
export function stringify(doc: Json): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Finds the line of a path in the formatted JSON, for jumping from an issue to the raw view. Best effort. */
export function lineOfPath(text: string, path: Path): number | undefined {
  const lines = text.split('\n');
  let line = 0;
  let depthIndent = 0;
  for (const key of path) {
    depthIndent += 2;
    if (typeof key === 'number') {
      // Count the items at this indentation.
      let count = -1;
      for (let i = line + 1; i < lines.length; i++) {
        const indent = lines[i].length - lines[i].trimStart().length;
        if (indent < depthIndent) return line + 1;
        if (indent === depthIndent && !/^[\]}]/.test(lines[i].trimStart())) {
          count++;
          if (count === key) {
            line = i;
            break;
          }
        }
      }
      continue;
    }
    const needle = ' '.repeat(depthIndent) + JSON.stringify(key) + ':';
    const found = lines.findIndex((l, i) => i > line && l.startsWith(needle));
    if (found < 0) return line + 1;
    line = found;
  }
  return line + 1;
}

/**
 * Several metadata documents as one, merged the way the library merges several metadata maps: validator lists are
 * concatenated, properties with the same name are merged, and scalar settings take the last value. For looking up
 * models and properties across the open documents (checks, completion, the tester's sample).
 */
export function mergeDocs(docs: readonly MetadataDoc[]): MetadataDoc {
  if (docs.length === 1) return docs[0];
  const list = (value: unknown): Json[] => (Array.isArray(value) ? value : []);
  const result: JsonObject = {};
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (!isPlainObject(value)) continue;
      if (key === 'global') {
        const previous = isPlainObject(result['global']) ? result['global'] : {};
        result['global'] = { ...previous, validators: [...list(previous['validators']), ...list(value['validators'])] };
        continue;
      }
      if (!isModelKey(key)) continue;
      const previous = isPlainObject(result[key]) ? result[key] : {};
      const properties: JsonObject = { ...(isPlainObject(previous['properties']) ? previous['properties'] : {}) };
      for (const [name, property] of Object.entries(isPlainObject(value['properties']) ? value['properties'] : {})) {
        if (!isPlainObject(property)) continue;
        const before = isPlainObject(properties[name]) ? properties[name] : {};
        properties[name] = { ...before, ...property, validators: [...list(before['validators']), ...list(property['validators'])] };
      }
      result[key] = { ...previous, ...value, validators: [...list(previous['validators']), ...list(value['validators'])], properties };
    }
  }
  return result;
}
