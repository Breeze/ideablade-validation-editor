// Validation metadata kept in TypeScript, such as TempHire's client-validation-metadata.ts:
//
//   export const clientValidationMetadata: ModelValidationMetadataMap = { ResourceName: { ... } };
//
// Reading finds every such object literal (a variable typed as a validation metadata map, or one that `satisfies` it)
// and turns it into JSON. Writing replaces just that object literal, so the imports, the doc comment and the rest of
// the file stay as they are. Runs in the main process: the TypeScript compiler needs Node.
const ts = require('typescript');

const METADATA_TYPE = /\b(ModelValidationMetadataMap|ModelValidationMetadataLike)\b/;

function createSourceFile(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /x$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** `x as const`, `(x)`, `x satisfies T`: the expression inside. */
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) {
    node = node.expression;
  }
  return node;
}

/** The metadata object literals in a file, by variable name. */
function findMetadata(sf) {
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const typed = node.type && METADATA_TYPE.test(node.type.getText(sf));
      const satisfies = ts.isSatisfiesExpression(node.initializer) && METADATA_TYPE.test(node.initializer.type.getText(sf));
      const literal = unwrap(node.initializer);
      if ((typed || satisfies) && literal && ts.isObjectLiteralExpression(literal)) {
        found.push({ name: node.name.text, literal, declaration: node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

class NotLiteral extends Error {
  constructor(node, sf, what) {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    super(`${what} at line ${line + 1}, column ${character + 1}: ${node.getText(sf).slice(0, 60)}`);
  }
}

/** The JSON value of a literal expression; anything else (identifiers, spreads, calls) can't be edited as data. */
function toJson(node, sf) {
  node = unwrap(node);
  if (ts.isObjectLiteralExpression(node)) {
    const result = {};
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) throw new NotLiteral(p, sf, 'A spread');
      if (ts.isShorthandPropertyAssignment(p)) throw new NotLiteral(p, sf, 'A reference to a variable');
      if (!ts.isPropertyAssignment(p)) throw new NotLiteral(p, sf, 'A method or accessor');
      const name = p.name;
      let key;
      if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) key = name.text;
      else if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) key = name.text;
      else throw new NotLiteral(p, sf, 'A computed key');
      result[key] = toJson(p.initializer, sf);
    }
    return result;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => {
      if (ts.isSpreadElement(e)) throw new NotLiteral(e, sf, 'A spread');
      return toJson(e, sf);
    });
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  throw new NotLiteral(node, sf, 'Code rather than a value');
}

/** True when the literal has comments inside it, which rewriting it would drop. */
function hasCommentsInside(literal, sf) {
  const text = sf.text;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text, undefined, literal.getStart(sf), literal.getEnd() - literal.getStart(sf));
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) return true;
  }
  return false;
}

/**
 * The metadata maps in a TypeScript file: `[{ name, json }]`, or `{ name, readOnly }` (with the reason) for one that
 * holds code the editor can't turn into data and back, such as a spread of another map.
 */
function readTsMetadata(text, fileName = 'metadata.ts') {
  const sf = createSourceFile(text, fileName);
  return findMetadata(sf).map(({ name, literal }) => {
    const hasComments = hasCommentsInside(literal, sf);
    try {
      return { name, json: toJson(literal, sf), hasComments };
    } catch (e) {
      return { name, json: {}, readOnly: `${e.message}. The editor only edits plain values.`, hasComments };
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Writing, in the style Prettier gives TempHire's files: single quotes, trailing commas, 100 columns.

const PRINT_WIDTH = 100;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function quote(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;
}

function key(k) {
  return IDENTIFIER.test(k) ? k : quote(k);
}

function inline(value) {
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? quote(value) : String(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  const entries = Object.entries(value);
  return entries.length ? `{ ${entries.map(([k, v]) => `${key(k)}: ${inline(v)}`).join(', ')} }` : '{}';
}

/**
 * A value as TypeScript source. `column` is where it starts, for the line width; `indent` the indentation of its line.
 * The map itself, its models and their `properties` are always one entry per line, as one would write them.
 */
function format(value, indent, column, depth, parentKey) {
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

function lineIndent(text, position) {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}

/** The file with the metadata map `name` replaced by `json`. Everything outside that object literal is kept. */
function writeTsMetadata(text, fileName, name, json) {
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
function withMetadataImport(text, fileName) {
  const sf = createSourceFile(text, fileName);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const hasIt = imports.some((d) => {
    const bindings = d.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) && bindings.elements.some((e) => e.name.text === 'ModelValidationMetadataMap');
  });
  if (hasIt) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const at = imports.length ? imports[0].getStart(sf) : 0;
  return text.slice(0, at) + METADATA_IMPORT + eol + (imports.length ? '' : eol) + text.slice(at);
}

/**
 * The file with another metadata map, `name`, holding `json`: an exported, typed constant added at the end, in the
 * file's line endings, with the type's import added if the file lacks it.
 */
function insertTsMetadata(text, fileName, name, json) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`'${name}' isn't a TypeScript name: letters, digits, _ and $, not starting with a digit.`);
  if (new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}($|[^\\w$])`).test(text)) throw new Error(`The file already uses the name '${name}'.`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let literal = format(json, '', 0, 0, undefined);
  if (eol === '\r\n') literal = literal.replace(/\n/g, '\r\n');
  const body = text.replace(/\s*$/, '');
  return withMetadataImport(`${body}${body ? eol + eol : ''}export const ${name}: ModelValidationMetadataMap = ${literal};${eol}`, fileName);
}

/** A new TypeScript file holding one metadata map, typed, with the type's import. */
function newTsMetadataFile(name, json) {
  return (
    `${METADATA_IMPORT}\n\n` +
    `export const ${name}: ModelValidationMetadataMap = ${format(json, '', 0, 0, undefined)};\n`
  );
}

module.exports = { readTsMetadata, writeTsMetadata, insertTsMetadata, newTsMetadataFile, formatTs: (json) => format(json, '', 0, 0, undefined) };
