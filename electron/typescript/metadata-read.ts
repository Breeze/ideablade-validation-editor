// Validation metadata kept in TypeScript, such as TempHire's client-validation-metadata.ts:
//
//   export const clientValidationMetadata: ModelValidationMetadataMap = { ResourceName: { ... } };
//
// Reading: this finds every such object literal (a variable typed as a validation metadata map, or one that
// `satisfies` it) and turns it into JSON. Writing (metadata-write.ts) uses findMetadata to replace just that object
// literal. Runs in the main process: the TypeScript compiler needs Node. The renderer reaches it through the
// `ts:read-metadata` handler (ipc/typescript.ts); its view of the result is `TsMetadata` in src/app/services/host.ts.
import ts from 'typescript';
import type { JsonObject, JsonValue, TsMetadata } from '../types';

/** A metadata map's declaration: its variable's name, the object literal, and the declaration (for removing it). */
export interface FoundMetadata {
  name: string;
  literal: ts.ObjectLiteralExpression;
  declaration: ts.VariableDeclaration;
}

/** The type names that mark a variable as a metadata map. */
const METADATA_TYPE = /\b(ModelValidationMetadataMap|ModelValidationMetadataLike)\b/;

/** The file parsed (no type checking: only its syntax is needed), as TSX when its name ends in x (or X). */
export function createSourceFile(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /x$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** `x as const`, `(x)`, `x satisfies T`: the expression inside. */
function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
    node = node.expression;
  }
  return node;
}

/** The metadata object literals in a file, by variable name. */
export function findMetadata(sf: ts.SourceFile): FoundMetadata[] {
  const found: FoundMetadata[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const typed = !!node.type && METADATA_TYPE.test(node.type.getText(sf));
      const satisfies = ts.isSatisfiesExpression(node.initializer) && METADATA_TYPE.test(node.initializer.type.getText(sf));
      const literal = unwrap(node.initializer);
      if ((typed || satisfies) && ts.isObjectLiteralExpression(literal)) {
        found.push({ name: node.name.text, literal, declaration: node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Code where the editor needs a plain value: the message says what and where, for the read-only note. */
class NotLiteral extends Error {
  constructor(node: ts.Node, sf: ts.SourceFile, what: string) {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    super(`${what} at line ${line + 1}, column ${character + 1}: ${node.getText(sf).slice(0, 60)}`);
  }
}

/** The JSON value of a literal expression; anything else (identifiers, spreads, calls) can't be edited as data. */
function toJson(expression: ts.Expression, sf: ts.SourceFile): JsonValue {
  const node = unwrap(expression);
  if (ts.isObjectLiteralExpression(node)) {
    const result: JsonObject = {};
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) throw new NotLiteral(p, sf, 'A spread');
      if (ts.isShorthandPropertyAssignment(p)) throw new NotLiteral(p, sf, 'A reference to a variable');
      if (!ts.isPropertyAssignment(p)) throw new NotLiteral(p, sf, 'A method or accessor');
      const name = p.name;
      let key: string;
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
function hasCommentsInside(literal: ts.Node, sf: ts.SourceFile): boolean {
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
export function readTsMetadata(text: string, fileName = 'metadata.ts'): TsMetadata[] {
  const sf = createSourceFile(text, fileName);
  return findMetadata(sf).map(({ name, literal }) => {
    const hasComments = hasCommentsInside(literal, sf);
    try {
      return { name, json: toJson(literal, sf) as JsonObject, hasComments };
    } catch (e) {
      return { name, json: {}, readOnly: `${(e as Error).message}. The editor only edits plain values.`, hasComments };
    }
  });
}
