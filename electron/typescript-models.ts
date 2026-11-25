// Reads the models (interfaces, object type aliases, classes) of a TypeScript file with the TypeScript compiler API,
// and the application's own validators and expression functions. It runs in the main process: the compiler needs
// Node, which the sandboxed renderer doesn't have. The results have the shapes of SourceModel, SourceValidator and
// SourceFunction in src/lib/sources.ts; main.ts adds them to every TS file it reads for the renderer
// (withTypeScriptModels).
import ts from 'typescript';

/** A model's property, as the source writes it. */
export interface SourceProperty {
  name: string;
  /** The type text, or `= <initializer>` for an untyped class field. */
  type: string;
  nullable?: boolean;
}

/** A model: an interface, an object type alias or a class. */
export interface SourceModel {
  name: string;
  kind: 'interface' | 'type' | 'class';
  /** The type it extends, by name as written. */
  base?: string;
  properties: SourceProperty[];
}

/** A validator the application registers itself. */
export interface SourceValidator {
  name: string;
  /** Registered as an asynchronous / synchronous validator (both when the file has both). */
  async: boolean;
  sync: boolean;
  defaultMessage?: string;
  /** Context settings its code reads: ctx.factor, ... */
  settings: string[];
  description?: string;
}

/** A function or value the application adds to the expression scope. */
export interface SourceFunction {
  name: string;
  /** Parameters, for a function; undefined for a value. */
  params?: string[];
  returns?: string;
  description?: string;
}

/** A file read for the renderer: its path and text, and (for a TS file) what was found in it, or why not. */
export interface ReadFile {
  path: string;
  text?: string;
  error?: string;
  models?: SourceModel[];
  validators?: SourceValidator[];
  functions?: SourceFunction[];
  parseError?: string;
}

/** Decorators that mark Angular building blocks rather than models. */
const NON_MODEL_DECORATORS = ['Component', 'Injectable', 'Directive', 'Pipe', 'NgModule'];

/** The file parsed (syntax only), as TSX when its name ends in x. */
function createSourceFile(text: string, fileName: string): ts.SourceFile {
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

// ---------------------------------------------------------------------------------------------------------------
// The application's own validators and expression functions

/** Context keys every validator gets; a validator reading only these has no settings of its own. */
const STANDARD_CONTEXT_KEYS = new Set([
  'model', 'modelType', 'propertyName', 'propertyNames', 'displayName', 'messageTemplate', 'value', 'validatorName',
  'isClient', 'isServer', 'metadata', 'expressionScope', 'expressionEvaluator', 'exception',
]);

/** The text of a string literal (or a template without substitutions); undefined for anything else. */
function stringValue(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/**
 * The doc comment of a node, or of the declaration it's part of (looking up to its statement, class, function or
 * property): the description the editor shows for a validator or function.
 */
function jsDocOf(node: ts.Node, sf: ts.SourceFile): string | undefined {
  for (let n: ts.Node | undefined = node; n && !ts.isSourceFile(n); n = n.parent) {
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
function settingsUsed(node: ts.Node, extraNames: string[] = []): string[] {
  const names = new Set(['ctx', 'context', ...extraNames]);
  const settings = new Set<string>();
  const addBindings = (pattern: ts.ObjectBindingPattern): void => {
    for (const element of pattern.elements) {
      const key = element.propertyName ? element.propertyName.getText() : ts.isIdentifier(element.name) ? element.name.text : undefined;
      if (key) settings.add(key);
    }
  };
  const visit = (n: ts.Node): void => {
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

/** The second parameter names of the functions in a node: the context parameter of `(value, ctx) => ...`. */
function contextParameterNames(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parameters[1] && ts.isIdentifier(n.parameters[1].name)) {
      names.push(n.parameters[1].name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** A message template given to withMessage(context, '...'), the first one found. */
function messageIn(node: ts.Node): string | undefined {
  let message: string | undefined;
  const visit = (n: ts.Node): void => {
    if (message) return;
    if (ts.isCallExpression(n) && n.expression.getText() === 'withMessage') message = stringValue(n.arguments[1]);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return message;
}

/** A validator class as found: `name` is the one it passes to super(...), if it does. */
type ValidatorClass = Omit<SourceValidator, 'name'> & { name?: string };

/**
 * The application's own validators and expression functions in a TypeScript file, for the editor to offer next to
 * the library's: `syncValidator(...)`/`asyncValidator(...)` calls, validator classes and the `{ name, fn }` factories
 * that create them, and the functions given to `provideExpressionScope(...)` or an `expressionScope` setting.
 */
export function parseTypeScriptApp(text: string, fileName = 'app.ts'): { validators: SourceValidator[]; functions: SourceFunction[] } {
  const sf = createSourceFile(text, fileName);
  const validators: SourceValidator[] = [];
  const functions: SourceFunction[] = [];
  const classes = new Map<string, ValidatorClass>(); // class name -> what it registers
  // A validator found twice (a class and its factory, say) is merged into one entry.
  const addValidator = (v: SourceValidator): void => {
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
  const visitClasses = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const base = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(sf);
      if (base && /Validator$/.test(base)) {
        let name: string | undefined;
        const findSuper = (n: ts.Node): void => {
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

  // An expression scope object: its functions (with parameters and return type) and values, by name.
  const scopeObject = (obj: ts.Node | undefined, origin: string): void => {
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
  // The object a factory returns: `() => ({ ... })`, `function () { return { ... }; }`, or the object itself.
  const returnedObject = (n: ts.Node | undefined): ts.ObjectLiteralExpression | undefined => {
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

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      // syncValidator('even', (v, ctx) => ..., 'message') / asyncValidator(...)
      const validatorName = stringValue(node.arguments[0]);
      if ((callee === 'syncValidator' || callee === 'asyncValidator') && validatorName) {
        addValidator({
          name: validatorName,
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
  for (const cls of classes.values()) if (cls.name) addValidator({ ...cls, name: cls.name });
  return { validators, functions };
}

/**
 * Adds the models, validators and functions (or `parseError`) to a file read for the renderer, for a TS file; other
 * files are returned as they are. Called for every file the renderer opens or a watcher reloads (main.ts).
 */
export function withTypeScriptModels<T extends ReadFile>(file: T): T {
  if (!/\.tsx?$/i.test(file.path) || file.text === undefined) return file;
  try {
    return { ...file, models: parseTypeScript(file.text, file.path), ...parseTypeScriptApp(file.text, file.path) };
  } catch (e) {
    return { ...file, parseError: String((e as Error | undefined)?.message ?? e) };
  }
}
