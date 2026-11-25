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
      const base = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(sf);
      // Validator classes are read as validators (parseTypeScriptApp), not as models.
      if (!decorators.some((d) => NON_MODEL_DECORATORS.includes(d)) && !/Validator$/.test(base ?? '')) {
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

// ---------------------------------------------------------------------------------------------------------------
// The application's own validators and expression functions

/** Context keys every validator gets; a validator reading only these has no settings of its own. */
const STANDARD_CONTEXT_KEYS = new Set([
  'model', 'modelType', 'propertyName', 'propertyNames', 'displayName', 'messageTemplate', 'value', 'validatorName',
  'isClient', 'isServer', 'metadata', 'expressionScope', 'expressionEvaluator', 'exception',
]);

function stringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function jsDocOf(node, sf) {
  for (let n = node; n && !ts.isSourceFile(n); n = n.parent) {
    const docs = ts.getJSDocCommentsAndTags(n).filter(ts.isJSDoc);
    if (docs.length) {
      const comment = docs[docs.length - 1].comment;
      return typeof comment === 'string' ? comment : comment?.map((c) => c.text).join('');
    }
    if (ts.isVariableStatement(n) || ts.isClassDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isPropertyAssignment(n)) break;
  }
  void sf;
  return undefined;
}

/**
 * Context settings a validator reads: `ctx.factor`, `context.minValue`, `ctx['factor']`, on the parameters named
 * like a context (ctx, context, c) or the second parameter of its validator function.
 */
function settingsUsed(node, extraNames = []) {
  const names = new Set(['ctx', 'context', ...extraNames]);
  const settings = new Set();
  const addBindings = (pattern) => {
    for (const element of pattern.elements) {
      const key = element.propertyName ? element.propertyName.getText() : ts.isIdentifier(element.name) ? element.name.text : undefined;
      if (key) settings.add(key);
    }
  };
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
      settings.add(n.name.text);
    } else if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
      const key = stringValue(n.argumentExpression);
      if (key) settings.add(key);
    } else if (
      ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && ts.isIdentifier(n.initializer) && names.has(n.initializer.text)
    ) {
      // const { factor, op = '==' } = ctx;
      addBindings(n.name);
    } else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters[1] && ts.isObjectBindingPattern(n.parameters[1].name)) {
      // (value, { factor }) => ...
      addBindings(n.parameters[1].name);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...settings].filter((s) => !STANDARD_CONTEXT_KEYS.has(s));
}

/** The second parameter name of the first function in a node: the context parameter of `(value, ctx) => ...`. */
function contextParameterNames(node) {
  const names = [];
  const visit = (n) => {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters[1] && ts.isIdentifier(n.parameters[1].name)) {
      names.push(n.parameters[1].name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** A message template given to withMessage(context, '...') or as a call's last string argument. */
function messageIn(node) {
  let message;
  const visit = (n) => {
    if (message) return;
    if (ts.isCallExpression(n) && n.expression.getText() === 'withMessage') message = stringValue(n.arguments[1]);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return message;
}

function parseTypeScriptApp(text, fileName = 'app.ts') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const validators = [];
  const functions = [];
  const classes = new Map(); // class name -> { name, async, defaultMessage, settings, description }
  const addValidator = (v) => {
    const existing = validators.find((x) => x.name === v.name);
    if (!existing) validators.push(v);
    else {
      existing.async ||= v.async;
      existing.sync ||= v.sync;
      existing.defaultMessage ??= v.defaultMessage;
      existing.description ??= v.description;
      existing.settings = [...new Set([...existing.settings, ...v.settings])];
    }
  };

  // Validator classes: class X extends SyncValidator / AsyncValidator { constructor(...) { super('name', group, ...) } }
  const visitClasses = (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const base = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(sf);
      if (base && /Validator$/.test(base)) {
        let name;
        const findSuper = (n) => {
          if (name) return;
          if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword) name = stringValue(n.arguments[0]);
          ts.forEachChild(n, findSuper);
        };
        findSuper(node);
        classes.set(node.name.text, {
          name,
          async: base === 'AsyncValidator',
          sync: base !== 'AsyncValidator',
          defaultMessage: messageIn(node),
          settings: settingsUsed(node, contextParameterNames(node)),
          description: jsDocOf(node, sf),
        });
      }
    }
    ts.forEachChild(node, visitClasses);
  };
  visitClasses(sf);

  const scopeObject = (obj, origin) => {
    if (!obj || !ts.isObjectLiteralExpression(obj)) return;
    for (const p of obj.properties) {
      const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
      if (!name) continue;
      const value = ts.isPropertyAssignment(p) ? p.initializer : undefined;
      const fn = ts.isMethodDeclaration(p) ? p : value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : undefined;
      if (fn) {
        functions.push({
          name,
          params: fn.parameters.map((x) => x.name.getText(sf) + (x.type ? `: ${x.type.getText(sf)}` : '')),
          returns: fn.type?.getText(sf) ?? (fn.body && ts.isNewExpression(fn.body) ? fn.body.expression.getText(sf) : undefined),
          description: jsDocOf(p, sf) ?? origin,
        });
      } else if (ts.isShorthandPropertyAssignment(p) || value) {
        // A value, or a function defined elsewhere (isWeekend, or isWeekend: isWeekendFn): offered by name.
        functions.push({ name, description: jsDocOf(p, sf) ?? origin });
      }
    }
  };
  const returnedObject = (n) => {
    if (!n) return undefined;
    if (ts.isParenthesizedExpression(n)) return returnedObject(n.expression);
    if (ts.isObjectLiteralExpression(n)) return n;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (!ts.isBlock(n.body)) return returnedObject(n.body);
      const ret = n.body.statements.find(ts.isReturnStatement);
      return returnedObject(ret?.expression);
    }
    return undefined;
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      // syncValidator('even', (v, ctx) => ..., 'message') / asyncValidator(...)
      if ((callee === 'syncValidator' || callee === 'asyncValidator') && stringValue(node.arguments[0])) {
        addValidator({
          name: stringValue(node.arguments[0]),
          async: callee === 'asyncValidator',
          sync: callee === 'syncValidator',
          defaultMessage: stringValue(node.arguments[2]),
          settings: node.arguments[1] ? settingsUsed(node.arguments[1], contextParameterNames(node.arguments[1])) : [],
          description: jsDocOf(node, sf),
        });
      }
      if (callee === 'provideExpressionScope') scopeObject(returnedObject(node.arguments[0]), 'provideExpressionScope');
    }
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(node.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(sf), p.initializer]));
      // { name: 'multipleOf', fn: (g, c) => new MultipleOfValidator(g, c) }
      const name = stringValue(props.get('name'));
      const fn = props.get('fn');
      if (name && fn) {
        const created = fn.getText(sf).match(/new\s+([\w$]+)/)?.[1];
        const cls = created ? classes.get(created) : undefined;
        addValidator({
          name,
          async: cls?.async ?? false,
          sync: cls?.sync ?? true,
          defaultMessage: cls?.defaultMessage,
          settings: cls?.settings ?? settingsUsed(fn, contextParameterNames(fn)),
          description: jsDocOf(node, sf) ?? cls?.description ?? (cls ? undefined : created ? `Creates ${created}.` : undefined),
        });
      }
      const scope = props.get('expressionScope');
      if (scope) scopeObject(returnedObject(scope) ?? scope, 'expressionScope');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Classes that name themselves in super(...) count even without a factory in this file.
  for (const cls of classes.values()) if (cls.name) addValidator({ ...cls });
  return { validators, functions };
}

/** Adds the models, validators and functions (or `parseError`) to a file read for the renderer, for a TS file. */
function withTypeScriptModels(file) {
  if (!/\.tsx?$/i.test(file.path) || file.text === undefined) return file;
  try {
    return { ...file, models: parseTypeScript(file.text, file.path), ...parseTypeScriptApp(file.text, file.path) };
  } catch (e) {
    return { ...file, parseError: String(e?.message ?? e) };
  }
}

module.exports = { parseTypeScript, parseTypeScriptApp, withTypeScriptModels };
