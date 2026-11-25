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

/**
 * The file with another metadata string constant, `name`, holding `json`: right after the last metadata string it has,
 * in the same class and with the same indentation. Where the file has the typed style (a ModelValidationMetadataMap
 * parsed from the JSON, as new files have), the new constant gets that too: `AdminJson` -> `AdminMetadata`.
 */
export function insertCsMetadata(text: string, name: string, json: JsonObject): string {
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error(`'${name}' isn't a C# name: letters, digits and _, not starting with a digit.`);
  if (new RegExp(`\\b${name}\\b`).test(text)) throw new Error(`The file already uses the name '${name}'.`);
  const literals = findLiterals(text).filter((l) => {
    try {
      return isMetadata(parseJsonWithComments(l.content).value);
    } catch {
      return false;
    }
  });
  const last = literals[literals.length - 1];
  if (!last) throw new Error('The file has no metadata string to add one next to.');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineStart = text.lastIndexOf('\n', last.start - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  // After the statement the string ends, or after the typed map parsed from it when that follows.
  let after = text.indexOf(';', last.end) + 1;
  const parsed = new RegExp(`ModelValidationMetadataMap\\.Parse\\(\\s*${last.name}\\s*\\)[^;]*;`).exec(text.slice(after, after + 600));
  if (parsed) after += parsed.index + parsed[0].length;
  const lineEnd = text.slice(after).search(/\r?\n|$/) + after;
  let block = `${eol}${eol}${indent}public const string ${name} = ${rawLiteral(json, indent + '    ', eol)};`;
  const typedName = `${name.replace(/Json$/, '') || name}Metadata`;
  if (parsed && !new RegExp(`\\b${typedName}\\b`).test(text)) {
    block += `${eol}${eol}${indent}public static readonly ModelValidationMetadataMap ${typedName} = ModelValidationMetadataMap.Parse(${name});`;
  }
  return text.slice(0, lineEnd) + block + text.slice(lineEnd);
}

/**
 * The file without the metadata string `name`: its whole declaration goes (`public const string AdminJson = """…""";`),
 * with the `///` or `//` comment lines right above it, and so does a typed map parsed from it
 * (`… = ModelValidationMetadataMap.Parse(AdminJson);`), with its comment. The blank line after each goes too.
 */
export function removeCsMetadata(text: string, name: string): string {
  const literal = findLiterals(text).find((l) => {
    if (l.name !== name) return false;
    try {
      return isMetadata(parseJsonWithComments(l.content).value);
    } catch {
      return false;
    }
  });
  if (!literal) throw new Error(`There is no metadata string '${name}' in this file any more.`);
  const statementEnd = text.indexOf(';', literal.end) + 1;
  let result = cutStatement(text, text.lastIndexOf('\n', literal.start - 1) + 1, statementEnd);
  const parsed = new RegExp(`^[^\\n;]*ModelValidationMetadataMap\\.Parse\\(\\s*${name}\\s*\\)[^;]*;`, 'm').exec(result);
  if (parsed) result = cutStatement(result, parsed.index, parsed.index + parsed[0].length);
  return result;
}

/** Cuts the lines from `lineStart` to the statement's end, with the comment lines above and one blank line after. */
function cutStatement(text: string, lineStart: number, end: number): string {
  let from = lineStart;
  for (;;) {
    const prevStart = text.lastIndexOf('\n', from - 2) + 1;
    if (from === 0 || !/^[ \t]*\/\//.test(text.slice(prevStart, from))) break;
    from = prevStart;
  }
  const rest = /^[ \t]*\r?\n([ \t]*\r?\n)?/.exec(text.slice(end));
  let before = text.slice(0, from);
  const after = text.slice(end + (rest ? rest[0].length : 0));
  // The class's last member: the blank line above it goes, not one before the closing brace.
  const blank = /\r?\n[ \t]*\r?\n$/.exec(before);
  if (blank && /^[ \t]*\}/.test(after)) before = before.slice(0, before.length - blank[0].length) + blank[0].slice(0, blank[0].indexOf('\n') + 1);
  return before + after;
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

/**
 * A new C# file holding one metadata map: the JSON as a raw string constant (what the editor reads and writes; a C#
 * const can only be a string) and, typed, the library's ModelValidationMetadataMap parsed from it, with its using.
 */
export function newCsMetadataFile(className: string, json: JsonObject): string {
  return [
    'using IdeaBlade.Validation.Metadata;',
    '',
    '// Validation metadata for IdeaBlade.Validation:',
    `//   services.AddIdeaBladeValidation(v => v.AddMetadata(${className}.Metadata));`,
    `public static class ${className}`,
    '{',
    '    /// <summary>The metadata as JSON (AddMetadataJson takes this too).</summary>',
    `    public const string Json = ${rawLiteral(json, '        ', '\n')};`,
    '',
    '    /// <summary>The metadata, parsed from <see cref="Json"/>.</summary>',
    '    public static readonly ModelValidationMetadataMap Metadata = ModelValidationMetadataMap.Parse(Json);',
    '}',
    '',
  ].join('\n');
}
