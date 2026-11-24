// Validation metadata kept in C#: the .NET library takes metadata as JSON (AddMetadataJson, ModelValidationMetadataMap
// .Parse), so in a .cs file it is a JSON string, usually a raw string literal:
//
//   public static class ClientValidationMetadata
//   {
//       public const string Json = """
//           { "ResourceName": { ... } }
//           """;
//   }
//
//   services.AddIdeaBladeValidation(v => v.AddMetadataJson(ClientValidationMetadata.Json));
//
// Reading finds the string literals (raw """...""" or verbatim @"...") whose content is a metadata object. Writing
// replaces just that literal. Like the .NET loader, reading accepts comments and trailing commas in the JSON.

import type { Json, JsonObject } from './doc';

export interface CsMetadata {
  /** The field, constant or variable the string is assigned to (or `AddMetadataJson #n` for an argument). */
  name: string;
  json: JsonObject;
  /** The JSON had comments, which writing it back drops. */
  hasComments: boolean;
}

interface Literal {
  name: string;
  start: number;
  end: number;
  kind: 'raw' | 'verbatim';
  content: string;
  /** For a raw literal: the indentation of its closing quotes. */
  indent: string;
}

/** Strings the C# reader skips over: regular "..." strings (with escapes) and character literals. */
function findLiterals(text: string): Literal[] {
  const literals: Literal[] = [];
  let unnamed = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (ch === '"' && text.startsWith('"""', i) && text[i - 1] !== '@' && text[i - 1] !== '$') {
      // Raw string literal: three or more quotes, content on the following lines, closing quotes on their own line.
      let quotes = 0;
      while (text[i + quotes] === '"') quotes++;
      const fence = '"'.repeat(quotes);
      const close = text.indexOf(fence, i + quotes);
      if (close < 0) break;
      const body = text.slice(i + quotes, close);
      const lines = body.split(/\r?\n/);
      if (lines.length >= 2) {
        const indent = lines[lines.length - 1];
        const content = lines.slice(1, -1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart())).join('\n');
        literals.push({ name: nameBefore(text, i) ?? `AddMetadataJson #${++unnamed}`, start: i, end: close + quotes, kind: 'raw', content, indent: /^[ \t]*$/.test(indent) ? indent : '' });
      }
      i = close + quotes;
      continue;
    }
    if (ch === '@' && text[i + 1] === '"') {
      let j = i + 2;
      let content = '';
      while (j < text.length) {
        if (text[j] === '"' && text[j + 1] === '"') {
          content += '"';
          j += 2;
        } else if (text[j] === '"') break;
        else content += text[j++];
      }
      literals.push({ name: nameBefore(text, i) ?? `AddMetadataJson #${++unnamed}`, start: i, end: j + 1, kind: 'verbatim', content, indent: '' });
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      const j = text.indexOf("'", i + (text[i + 1] === '\\' ? 3 : 2));
      i = j < 0 ? i + 1 : j + 1;
      continue;
    }
    i++;
  }
  return literals;
}

/** `const string Json = `, `Json = `, `string json = ` before a literal. */
function nameBefore(text: string, index: number): string | undefined {
  return /([A-Za-z_]\w*)\s*=\s*$/.exec(text.slice(Math.max(0, index - 200), index))?.[1];
}

/** JSON with // and /* comments and trailing commas, as System.Text.Json reads it with those options. */
export function parseJsonWithComments(text: string): { value: Json; hasComments: boolean } {
  let hasComments = false;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && text[i + 1] === '/') {
      hasComments = true;
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      hasComments = true;
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 1;
    } else {
      out += ch;
    }
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return { value: JSON.parse(out) as Json, hasComments };
}

/** Looks like validation metadata: an object whose entries are model entries, `global`, `$schema` or `$comment`. */
function isMetadata(value: Json): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value).filter(([k]) => !k.startsWith('$'));
  return entries.length > 0 && entries.every(([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v));
}

/** The metadata JSON strings in a C# file. */
export function readCsMetadata(text: string): CsMetadata[] {
  const result: CsMetadata[] = [];
  for (const literal of findLiterals(text)) {
    try {
      const { value, hasComments } = parseJsonWithComments(literal.content);
      if (isMetadata(value)) result.push({ name: literal.name, json: value, hasComments });
    } catch {
      // not JSON: some other string
    }
  }
  return result;
}

function rawLiteral(json: JsonObject, indent: string, eol: string): string {
  const content = JSON.stringify(json, null, 2);
  let quotes = 3;
  for (const run of content.match(/"{3,}/g) ?? []) quotes = Math.max(quotes, run.length + 1);
  const fence = '"'.repeat(quotes);
  return [fence, ...content.split('\n').map((l) => (l ? indent + l : l)), indent + fence].join(eol);
}

/** The file with the metadata string `name` replaced by `json`. Everything outside the string literal is kept. */
export function writeCsMetadata(text: string, name: string, json: JsonObject): string {
  const literal = findLiterals(text).find((l) => {
    if (l.name !== name) return false;
    try {
      return isMetadata(parseJsonWithComments(l.content).value);
    } catch {
      return false;
    }
  });
  if (!literal) throw new Error(`There is no metadata string '${name}' in this file any more.`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineStart = text.lastIndexOf('\n', literal.start - 1) + 1;
  const lineIndent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  const replacement =
    literal.kind === 'raw'
      ? rawLiteral(json, literal.indent || lineIndent + '    ', eol)
      : '@"' + JSON.stringify(json, null, 2).replace(/"/g, '""').replace(/\n/g, eol) + '"';
  return text.slice(0, literal.start) + replacement + text.slice(literal.end);
}

/** `client-validation-metadata.cs` -> `ClientValidationMetadata` */
export function pascalCaseFromFile(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? 'ValidationMetadata').replace(/\.[^.]*$/, '').replace(/\.metadata$/i, 'Metadata');
  const name = base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z_]/.test(name) ? name : `Metadata${name}`;
}

/** A new C# file holding one metadata map as a raw string constant. */
export function newCsMetadataFile(className: string, json: JsonObject): string {
  return [
    '// Validation metadata for IdeaBlade.Validation, as JSON:',
    `//   services.AddIdeaBladeValidation(v => v.AddMetadataJson(${className}.Json));`,
    `public static class ${className}`,
    '{',
    `    public const string Json = ${rawLiteral(json, '        ', '\n')};`,
    '}',
    '',
  ].join('\n');
}
