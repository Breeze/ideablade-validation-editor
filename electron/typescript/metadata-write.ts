// Writing validation metadata kept in TypeScript (see metadata-read.ts for what such a file looks like): replacing a
// map's object literal, adding a map, removing one, and a new file holding one. Only the object literal changes, so
// the imports, the doc comment and the rest of the file stay as they are. The renderer reaches these through the
// `ts:*` handlers (ipc/typescript.ts); they work on text only, the renderer reads and writes the file itself.
import ts from 'typescript';
import type { JsonObject, JsonValue } from '../types';
import { createSourceFile, findMetadata } from './metadata-read';

// Maps are written in the style Prettier gives TempHire's files: single quotes, trailing commas, 100 columns.

const PRINT_WIDTH = 100;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A string as a single-quoted TypeScript literal. */
function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;
}

/** A property name: bare when it's an identifier, else quoted. */
function key(k: string): string {
  return IDENTIFIER.test(k) ? k : quote(k);
}

/** A value on one line: `{ a: 1, b: [2, 3] }`. */
function inline(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? quote(value) : String(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  const entries = Object.entries(value);
  return entries.length ? `{ ${entries.map(([k, v]) => `${key(k)}: ${inline(v)}`).join(', ')} }` : '{}';
}

/**
 * A value as TypeScript source. `column` is where it starts, for the line width; `indent` the indentation of its line.
 * The map itself, its models and their `properties` are always one entry per line, as one would write them.
 */
function format(value: JsonValue, indent: string, column: number, depth: number, parentKey: string | undefined): string {
  if (value === null || typeof value !== 'object') return inline(value);
  const flat = inline(value);
  const forceMultiline = depth <= 1 || parentKey === 'properties' || parentKey === 'global' || parentKey === '$comment';
  if (!forceMultiline && column + flat.length <= PRINT_WIDTH && !flat.includes('\n')) return flat;
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${inner}${format(v, inner, inner.length, depth + 1, undefined)},`).join('\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => {
    const head = `${inner}${key(k)}: `;
    return `${head}${format(v, inner, head.length + 1, depth + 1, k)},`;
  });
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/** The indentation (spaces and tabs) of the line `position` is on. */
function lineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** The file with the metadata map `name` replaced by `json`. Everything outside that object literal is kept. */
export function writeTsMetadata(text: string, fileName: string, name: string, json: JsonObject): string {
  const sf = createSourceFile(text, fileName);
  const found = findMetadata(sf).find((m) => m.name === name);
  if (!found) throw new Error(`There is no metadata map '${name}' in ${fileName} any more.`);
  const start = found.literal.getStart(sf);
  const end = found.literal.getEnd();
  const indent = lineIndent(text, start);
  const column = start - (text.lastIndexOf('\n', start - 1) + 1);
  let literal = format(json, indent, column, 0, undefined);
  if (text.includes('\r\n')) literal = literal.replace(/\n/g, '\r\n'); // keep the file's line endings
  return withMetadataImport(text.slice(0, start) + literal + text.slice(end), fileName);
}

const METADATA_IMPORT = `import type { ModelValidationMetadataMap } from 'ideablade-validation';`;

/**
 * The file with `ModelValidationMetadataMap` imported, so the map's type annotation compiles: added above the first
 * import (or at the top) when no import brings it in. A file that imports it already is left as it is.
 */
function withMetadataImport(text: string, fileName: string): string {
  const sf = createSourceFile(text, fileName);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const hasIt = imports.some((d) => {
    const bindings = d.importClause?.namedBindings;
    return !!bindings && ts.isNamedImports(bindings) && bindings.elements.some((e) => e.name.text === 'ModelValidationMetadataMap');
  });
  if (hasIt) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const at = imports.length ? imports[0].getStart(sf) : 0;
  return text.slice(0, at) + METADATA_IMPORT + eol + (imports.length ? '' : eol) + text.slice(at);
}

/**
 * The file with another metadata map, `name`, holding `json`: an exported, typed constant added at the end, in the
 * file's line endings, with the type's import added if the file lacks it. Refuses a name that isn't an identifier or
 * that the file already uses.
 */
export function insertTsMetadata(text: string, fileName: string, name: string, json: JsonObject): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`'${name}' isn't a TypeScript name: letters, digits, _ and $, not starting with a digit.`);
  if (new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}($|[^\\w$])`).test(text)) throw new Error(`The file already uses the name '${name}'.`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let literal = format(json, '', 0, 0, undefined);
  if (eol === '\r\n') literal = literal.replace(/\n/g, '\r\n');
  const body = text.replace(/\s*$/, '');
  return withMetadataImport(`${body}${body ? eol + eol : ''}export const ${name}: ModelValidationMetadataMap = ${literal};${eol}`, fileName);
}

/**
 * The file without the metadata map `name`: its whole statement goes (`export const name: … = { … };`), with the doc
 * comment above it and the blank line after it. The rest of the file is kept as it is.
 */
export function removeTsMetadata(text: string, fileName: string, name: string): string {
  const sf = createSourceFile(text, fileName);
  const found = findMetadata(sf).find((m) => m.name === name);
  if (!found) throw new Error(`There is no metadata map '${name}' in ${fileName} any more.`);
  let node: ts.Node | undefined = found.declaration;
  while (node && !ts.isVariableStatement(node)) node = node.parent;
  if (!node) throw new Error(`The map '${name}' isn't declared on its own in ${fileName}.`);
  const statement = node as ts.VariableStatement;
  if (statement.declarationList.declarations.length > 1) {
    throw new Error(`'${name}' is declared together with other variables in ${fileName}: remove it there.`);
  }
  const start = statement.getFullStart() === 0 ? 0 : text.lastIndexOf('\n', statement.getStart(sf) - 1) + 1;
  // From the start of its line, or of its leading comments (the doc comment above it)
  const leading = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? [];
  const from = leading.length ? text.lastIndexOf('\n', leading[0].pos - 1) + 1 : start;
  let to = statement.getEnd();
  const rest = /^[ \t]*\r?\n([ \t]*\r?\n)?/.exec(text.slice(to)); // the line's end, and one blank line after it
  if (rest) to += rest[0].length;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  // A file ends with one line break, also when the last map went.
  return (text.slice(0, from) + text.slice(to)).replace(/\s+$/, '') + eol;
}

/** A new TypeScript file holding one metadata map, typed, with the type's import (File → New → TypeScript). */
export function newTsMetadataFile(name: string, json: JsonObject): string {
  return (
    `${METADATA_IMPORT}\n\n` +
    `export const ${name}: ModelValidationMetadataMap = ${format(json, '', 0, 0, undefined)};\n`
  );
}

/** A metadata map as the object literal the writers produce, starting at column 0. */
export const formatTs = (json: JsonObject): string => format(json, '', 0, 0, undefined);
