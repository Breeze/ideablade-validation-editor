// Reads the application's own validators and expression functions from a TypeScript file with the TypeScript compiler
// API, so the editor can offer them next to the library's: `syncValidator(...)`/`asyncValidator(...)` calls, validator
// classes and the `{ name, fn }` factories that create them, and the functions given to `provideExpressionScope(...)`
// or an `expressionScope` setting. The results have the shapes of SourceValidator and SourceFunction in
// src/lib/sources.ts; read-file.ts adds them to every TS file read for the renderer, with its models (models.ts).
import ts from 'typescript';
import type { SourceFunction, SourceValidator } from '../types';
import { createSourceFile } from './models';

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

/** Methods that only a Date has, a string has, or a number has: calling one on the value says what it is. */
const DATE_METHODS = new Set(['getTime', 'getDay', 'getDate', 'getMonth', 'getFullYear', 'getHours', 'getMinutes', 'toISOString', 'toDateString']);
const STRING_METHODS = new Set(['trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'split', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'charAt', 'localeCompare', 'normalize']);
const NUMBER_METHODS = new Set(['toFixed', 'toPrecision']);
const ARITHMETIC = new Set([ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskAsteriskToken]);

/**
 * The type of value a validator function works with, so the editor can tell when a rule is on a property of another
 * kind: the value parameter's declared type (`(login: string) => ...`), or else what the body does with it: arithmetic
 * (`v % ctx.factor`) or Math / Number.isInteger: a number; Date methods (`v.getDay()`): a Date; string methods
 * (`v.trim()`): a string. Undefined when it makes text of any value (`String(v)`, `${v}`), shows more than one
 * kind, or doesn't say: such a validator counts as taking any value.
 */
function valueTypeOf(fn: ts.Node | undefined, sf: ts.SourceFile): string | undefined {
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return undefined;
  const param = fn.parameters[0];
  if (!param) return undefined;
  if (param.type) return param.type.getText(sf);
  if (!ts.isIdentifier(param.name)) return undefined;
  const name = param.name.text;
  const isValue = (n: ts.Node | undefined): boolean => !!n && ts.isIdentifier(n) && n.text === name;
  const found = new Set<string>();
  let anyValue = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (callee === 'String' && isValue(n.arguments[0])) anyValue = true;
      else if (/^(Math\.\w+|Number\.is(Integer|Finite|SafeInteger))$/.test(callee) && n.arguments.some(isValue)) found.add('number');
    } else if (ts.isTemplateSpan(n) && isValue(n.expression)) {
      anyValue = true;
    } else if (ts.isBinaryExpression(n) && ARITHMETIC.has(n.operatorToken.kind) && (isValue(n.left) || isValue(n.right))) {
      found.add('number');
    } else if (ts.isPropertyAccessExpression(n) && isValue(n.expression)) {
      const method = n.name.text;
      if (DATE_METHODS.has(method)) found.add('Date');
      else if (STRING_METHODS.has(method)) found.add('string');
      else if (NUMBER_METHODS.has(method)) found.add('number');
    }
    ts.forEachChild(n, visit);
  };
  visit(fn.body);
  return anyValue || found.size !== 1 ? undefined : [...found][0];
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
      existing.valueType ??= v.valueType;
    }
  };

  // Validator classes: class X extends SyncValidator / AsyncValidator { constructor(...) { super('name', group, ...) } }
  const visitClasses = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const base = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(sf);
      if (base && /Validator$/.test(base)) {
        let name: string | undefined;
        let valueType: string | undefined;
        // super('name', group, (value, ctx) => ..., ...): the name, and the function's value type
        const findSuper = (n: ts.Node): void => {
          if (name) return;
          if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword) {
            name = stringValue(n.arguments[0]);
            valueType = valueTypeOf(n.arguments[2], sf);
          }
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
          valueType,
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
          valueType: valueTypeOf(node.arguments[1], sf),
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
          valueType: cls?.valueType,
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
