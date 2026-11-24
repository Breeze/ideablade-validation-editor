// Reads the models (interfaces, object type aliases, classes) of a TypeScript file with the TypeScript compiler API.
// It runs in the main process: the compiler needs Node, which the sandboxed renderer doesn't have. The result has the
// shape of SourceModel in src/lib/sources.ts.
const ts = require('typescript');

/** Decorators that mark Angular building blocks rather than models. */
const NON_MODEL_DECORATORS = ['Component', 'Injectable', 'Directive', 'Pipe', 'NgModule'];

function parseTypeScript(text, fileName = 'model.ts') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const models = [];
  const typeText = (node) => (node ? node.getText(sf).replace(/\s+/g, ' ') : 'unknown');
  const nameText = (name) =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : undefined;
  const hasModifier = (node, kind) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
  const isHidden = (node) =>
    hasModifier(node, ts.SyntaxKind.PrivateKeyword) || hasModifier(node, ts.SyntaxKind.ProtectedKeyword) || hasModifier(node, ts.SyntaxKind.StaticKeyword);
  const baseOf = (clauses) => {
    const ext = clauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    return ext ? ext.expression.getText(sf) : undefined;
  };
  const isFunctionLike = (node) => !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionTypeNode(node));

  const fromMembers = (members) =>
    members.flatMap((m) => {
      if (!ts.isPropertySignature(m)) return [];
      const name = nameText(m.name);
      if (!name || isFunctionLike(m.type)) return [];
      return [{ name, type: typeText(m.type), nullable: !!m.questionToken }];
    });

  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      models.push({ name: node.name.text, kind: 'interface', base: baseOf(node.heritageClauses), properties: fromMembers(node.members) });
    } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      models.push({ name: node.name.text, kind: 'type', properties: fromMembers(node.type.members) });
    } else if (ts.isClassDeclaration(node) && node.name) {
      const decorators = (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []).map((d) =>
        ts.isCallExpression(d.expression) ? d.expression.expression.getText(sf) : d.expression.getText(sf),
      );
      if (!decorators.some((d) => NON_MODEL_DECORATORS.includes(d))) {
        const properties = [];
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

/** Adds `models` (or `parseError`) to a file read for the renderer, when it's a TypeScript file. */
function withTypeScriptModels(file) {
  if (!/\.tsx?$/i.test(file.path) || file.text === undefined) return file;
  try {
    return { ...file, models: parseTypeScript(file.text, file.path) };
  } catch (e) {
    return { ...file, parseError: String(e?.message ?? e) };
  }
}

module.exports = { parseTypeScript, withTypeScriptModels };
