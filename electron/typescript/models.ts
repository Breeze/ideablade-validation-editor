// Reads the models (interfaces, object type aliases, classes) of a TypeScript file with the TypeScript compiler API,
// for the editor's model list. It runs in the main process: the compiler needs Node, which the sandboxed renderer
// doesn't have. The results have the shape of SourceModel in src/lib/sources.ts; read-file.ts adds them to every TS
// file read for the renderer, with the application's validators and functions (app-validators.ts).
import ts from 'typescript';
import type { SourceModel, SourceProperty } from '../types';

/** Decorators that mark Angular building blocks rather than models. */
const NON_MODEL_DECORATORS = ['Component', 'Injectable', 'Directive', 'Pipe', 'NgModule'];

/** The file parsed (syntax only), as TSX when its name ends in x. app-validators.ts parses with it too. */
export function createSourceFile(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * The models in a TypeScript file: interfaces, object type aliases and classes (but not Angular components, services
 * and the like, nor validator classes), each with its public, non-function properties. Top level and in namespaces.
 */
export function parseTypeScript(text: string, fileName = 'model.ts'): SourceModel[] {
  const sf = createSourceFile(text, fileName);
  const models: SourceModel[] = [];
  const typeText = (node: ts.Node | undefined): string => (node ? node.getText(sf).replace(/\s+/g, ' ') : 'unknown');
  const nameText = (name: ts.Node): string | undefined =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : undefined;
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
  const isHidden = (node: ts.Node): boolean =>
    hasModifier(node, ts.SyntaxKind.PrivateKeyword) || hasModifier(node, ts.SyntaxKind.ProtectedKeyword) || hasModifier(node, ts.SyntaxKind.StaticKeyword);
  const baseOf = (clauses: ts.NodeArray<ts.HeritageClause> | undefined): string | undefined => {
    const ext = clauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    return ext ? ext.expression.getText(sf) : undefined;
  };
  const isFunctionLike = (node: ts.Node | undefined): boolean =>
    !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionTypeNode(node));

  // An interface's or type literal's properties; methods and function-typed properties aren't data.
  const fromMembers = (members: ts.NodeArray<ts.TypeElement>): SourceProperty[] =>
    members.flatMap((m) => {
      if (!ts.isPropertySignature(m)) return [];
      const name = nameText(m.name);
      if (!name || isFunctionLike(m.type)) return [];
      return [{ name, type: typeText(m.type), nullable: !!m.questionToken }];
    });

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      models.push({ name: node.name.text, kind: 'interface', base: baseOf(node.heritageClauses), properties: fromMembers(node.members) });
    } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      models.push({ name: node.name.text, kind: 'type', properties: fromMembers(node.type.members) });
    } else if (ts.isClassDeclaration(node) && node.name) {
      const decorators = (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []).map((d) =>
        ts.isCallExpression(d.expression) ? d.expression.expression.getText(sf) : d.expression.getText(sf),
      );
      const base = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(sf);
      // Validator classes are read as validators (parseTypeScriptApp), not as models.
      if (!decorators.some((d) => NON_MODEL_DECORATORS.includes(d)) && !/Validator$/.test(base ?? '')) {
        const properties: SourceProperty[] = [];
        for (const m of node.members) {
          if (isHidden(m)) continue;
          if (ts.isPropertyDeclaration(m)) {
            const name = nameText(m.name);
            if (!name || ts.isPrivateIdentifier(m.name) || isFunctionLike(m.initializer) || isFunctionLike(m.type)) continue;
            const type = m.type ? typeText(m.type) : m.initializer ? `= ${typeText(m.initializer).slice(0, 40)}` : 'unknown';
            properties.push({ name, type, nullable: !!m.questionToken });
          } else if (ts.isGetAccessorDeclaration(m)) {
            const name = nameText(m.name);
            if (name && !properties.some((p) => p.name === name)) properties.push({ name, type: typeText(m.type) });
          } else if (ts.isConstructorDeclaration(m)) {
            // Parameter properties: constructor(public name: string, readonly id: number)
            for (const p of m.parameters) {
              const isParameterProperty =
                hasModifier(p, ts.SyntaxKind.PublicKeyword) || (hasModifier(p, ts.SyntaxKind.ReadonlyKeyword) && !isHidden(p));
              const name = nameText(p.name);
              if (isParameterProperty && name) properties.push({ name, type: typeText(p.type), nullable: !!p.questionToken });
            }
          }
        }
        models.push({ name: node.name.text, kind: 'class', base: baseOf(node.heritageClauses), properties });
      }
    }
    if (ts.isModuleDeclaration(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
      ts.forEachChild(node, visit);
    }
  };
  visit(sf);
  return models;
}
