// Code completion for expressions (model conditions, validator conditions, the `expression` validator).
//
// What's in scope comes from the library: the variables each kind of expression gets (docs/expressions.md and
// ValidatorMetadata / ModelMetadata.evalCondition), the context members the service always sets, DEFAULT_GLOBALS
// and the allow-listed methods of the safe evaluator. The model's properties come from the metadata and the model
// sources, and the application's own expression functions from the source files. Anything else (values a context
// provider adds, properties of a type the editor doesn't know) is simply not offered: completion never complains.

import { DEFAULT_GLOBALS, SafeNamespace } from 'ideablade-validation';

import { type MetadataDoc, isPlainObject } from './doc';
import type { Catalog, SourceFunction } from './sources';

export type ExpressionKind = 'validatorCondition' | 'expression' | 'modelCondition';

/** Where an expression is: what it's for, and the model and property it's about. */
export interface ExpressionSite {
  kind: ExpressionKind;
  modelType?: string;
  /** Set for a property rule; undefined for a model-level or global rule. */
  propertyName?: string;
  /** The rule's own context settings (minValue, messageTemplate, ...): they are in `context` too. */
  contextKeys?: readonly string[];
}

export interface CompletionEnv {
  doc: MetadataDoc;
  catalog: Catalog;
  /** The application's expression functions (expressionScope, provideExpressionScope, AddExpressionFunction). */
  functions: readonly SourceFunction[];
}

export type TypeRef =
  | { k: 'model'; name: string }
  | { k: 'array'; of: TypeRef }
  | { k: 'object'; name: string; members: Member[] }
  | { k: 'namespace'; name: string }
  | { k: 'string' | 'number' | 'boolean' | 'date' | 'regexp' | 'any' };

export interface Member {
  name: string;
  type: TypeRef;
  /** `function` and `method` members are called; `returns` is the call's type. */
  kind: 'variable' | 'property' | 'function' | 'method' | 'constant' | 'keyword' | 'type';
  returns?: TypeRef;
  detail?: string;
  info?: string;
}

export interface CompletionResult {
  from: number;
  options: Member[];
}

const ANY: TypeRef = { k: 'any' };
const STRING: TypeRef = { k: 'string' };
const NUMBER: TypeRef = { k: 'number' };
const BOOLEAN: TypeRef = { k: 'boolean' };
const DATE: TypeRef = { k: 'date' };

// ---------------------------------------------------------------------------------------------------------------
// Types of properties, from the model sources

/** A property's type, from Breeze's data types, or TS / C# type text. Unknown types are `any`. */
export function typeFromText(text: string | undefined, catalog: Catalog): TypeRef {
  if (!text) return ANY;
  let t = text.trim().replace(/^readonly\s+/, '');
  t = t
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'null' && s !== 'undefined')
    .join('|');
  if (t.includes('|')) return ANY;
  t = t.replace(/\?$/, '').replace(/^Nullable<(.+)>$/, '$1').replace(/^global::/, '');
  const array = /^(.+)\[\]$/.exec(t) ?? /^(?:Array|ReadonlyArray|List|IList|IReadOnlyList|ICollection|IReadOnlyCollection|IEnumerable|HashSet|ISet|Collection|ObservableCollection)<(.+)>$/.exec(t);
  if (array) return { k: 'array', of: typeFromText(array[1], catalog) };
  const short = t.replace(/^System\./, '');
  switch (short.toLowerCase()) {
    case 'string': case 'guid': case 'char': case 'time': case 'timespan':
      return STRING;
    case 'number': case 'int': case 'int16': case 'int32': case 'int64': case 'long': case 'short': case 'byte': case 'sbyte':
    case 'uint': case 'ulong': case 'ushort': case 'decimal': case 'double': case 'float': case 'single': case 'bigint':
      return NUMBER;
    case 'boolean': case 'bool':
      return BOOLEAN;
    case 'date': case 'datetime': case 'datetimeoffset': case 'dateonly':
      return DATE;
    case 'regexp': case 'regex':
      return { k: 'regexp' };
  }
  const name = short.replace(/<.*$/, '');
  return catalog.has(name) ? { k: 'model', name } : ANY;
}

/** A model's properties: the model sources', the metadata's and, through `extends`, its parent's. */
export function modelMembers(modelType: string, env: CompletionEnv, seen = new Set<string>()): Member[] {
  if (seen.has(modelType)) return [];
  seen.add(modelType);
  const members: Member[] = [];
  const add = (m: Member) => {
    if (!members.some((x) => x.name === m.name)) members.push(m);
  };
  const catalogModel = env.catalog.get(modelType);
  for (const p of catalogModel?.properties ?? []) {
    const type = typeFromText(p.type, env.catalog);
    add({ name: p.name, kind: 'property', type, detail: p.type + (p.nullable ? ' (nullable)' : ''), info: p.navigation ? 'Navigation property' : undefined });
  }
  const entry = env.doc[modelType];
  if (isPlainObject(entry)) {
    const properties = isPlainObject(entry['properties']) ? entry['properties'] : {};
    for (const [name, property] of Object.entries(properties)) {
      const displayName = isPlainObject(property) && typeof property['displayName'] === 'string' ? property['displayName'] : undefined;
      add({ name, kind: 'property', type: ANY, detail: 'in the metadata', info: displayName ? `Display name: ${displayName}` : undefined });
    }
    if (typeof entry['extends'] === 'string') modelMembers(entry['extends'], env, seen).forEach(add);
  }
  return members;
}

// ---------------------------------------------------------------------------------------------------------------
// Members of the built-in types (the safe evaluator's allow-lists)

const m = (name: string, returns: TypeRef, detail: string, info?: string): Member => ({ name, kind: 'method', type: ANY, returns, detail, info });
const prop = (name: string, type: TypeRef, detail: string, info?: string): Member => ({ name, kind: 'property', type, detail, info });

const STRING_MEMBERS: Member[] = [
  prop('length', NUMBER, 'number'),
  ...['at', 'charAt', 'concat', 'normalize', 'padEnd', 'padStart', 'replace', 'replaceAll', 'slice', 'substring', 'substr',
    'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toString', 'toUpperCase', 'trim', 'trimEnd', 'trimStart', 'valueOf'].map((n) => m(n, STRING, '(…) → string')),
  ...['charCodeAt', 'codePointAt', 'indexOf', 'lastIndexOf', 'localeCompare', 'search'].map((n) => m(n, NUMBER, '(…) → number')),
  ...['endsWith', 'includes', 'startsWith'].map((n) => m(n, BOOLEAN, '(…) → boolean')),
  m('split', { k: 'array', of: STRING }, '(separator) → string[]'),
  m('match', { k: 'array', of: STRING }, '(regexp) → string[] | null'),
];
const NUMBER_MEMBERS: Member[] = ['toFixed', 'toPrecision', 'toString', 'toLocaleString'].map((n) => m(n, STRING, '(…) → string')).concat(m('valueOf', NUMBER, '() → number'));
const BOOLEAN_MEMBERS: Member[] = [m('toString', STRING, '() → string'), m('valueOf', BOOLEAN, '() → boolean')];
const DATE_MEMBERS: Member[] = [
  ...['getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds', 'getMinutes', 'getMonth', 'getSeconds', 'getTime', 'getTimezoneOffset',
    'getUTCDate', 'getUTCDay', 'getUTCFullYear', 'getUTCHours', 'getUTCMilliseconds', 'getUTCMinutes', 'getUTCMonth', 'getUTCSeconds'].map((n) =>
    m(n, NUMBER, '() → number', n === 'getMonth' ? '0-based: January is 0.' : n === 'getTime' ? 'Milliseconds since 1970. Compare dates with this: two Date objects are never ===.' : undefined),
  ),
  ...['toDateString', 'toISOString', 'toJSON', 'toLocaleDateString', 'toLocaleString', 'toLocaleTimeString', 'toString', 'toTimeString', 'toUTCString'].map((n) => m(n, STRING, '() → string')),
  m('valueOf', NUMBER, '() → number'),
];
const REGEXP_MEMBERS: Member[] = [m('test', BOOLEAN, '(string) → boolean'), m('toString', STRING, '() → string')];

/** Array methods whose callback's first parameter is an element. */
const ELEMENT_CALLBACKS = new Set(['every', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'map', 'some']);

function arrayMembers(of: TypeRef): Member[] {
  const same: TypeRef = { k: 'array', of };
  const el = describe(of);
  return [
    prop('length', NUMBER, 'number'),
    m('some', BOOLEAN, `(x => …) → boolean`, 'True when the callback is truthy for any element.'),
    m('every', BOOLEAN, `(x => …) → boolean`, 'True when the callback is truthy for every element.'),
    m('filter', same, `(x => …) → ${el}[]`),
    m('find', of, `(x => …) → ${el}`),
    m('findLast', of, `(x => …) → ${el}`),
    m('findIndex', NUMBER, '(x => …) → number'),
    m('findLastIndex', NUMBER, '(x => …) → number'),
    m('includes', BOOLEAN, '(value) → boolean'),
    m('indexOf', NUMBER, '(value) → number'),
    m('lastIndexOf', NUMBER, '(value) → number'),
    m('map', { k: 'array', of: ANY }, '(x => …) → any[]'),
    m('flatMap', { k: 'array', of: ANY }, '(x => …) → any[]'),
    m('flat', { k: 'array', of: ANY }, '() → any[]'),
    m('reduce', ANY, '((acc, x) => …, initial) → any'),
    m('reduceRight', ANY, '((acc, x) => …, initial) → any'),
    m('at', of, `(index) → ${el}`),
    m('slice', same, `(start, end) → ${el}[]`),
    m('concat', same, `(…) → ${el}[]`),
    m('toSorted', same, `((a, b) => …) → ${el}[]`),
    m('toReversed', same, `() → ${el}[]`),
    m('join', STRING, '(separator) → string'),
    m('toString', STRING, '() → string'),
  ];
}

const NAMESPACE_DOCS: Record<string, string> = {
  Math: 'Math functions and constants (no Math.random, so expressions stay deterministic).',
  Date: 'Date.now(), Date.parse(), Date.UTC(), and new Date(…).',
  Number: 'Number(x) converts; plus the Number.is… checks and constants.',
  String: 'String(x) converts to a string.',
  Boolean: 'Boolean(x) converts to a boolean.',
  Array: 'Array.isArray(x).',
  Object: 'Object.keys, Object.values, Object.entries.',
};

function namespaceMembers(name: string): Member[] {
  const ns = DEFAULT_GLOBALS[name];
  if (!(ns instanceof SafeNamespace)) return [];
  return Object.entries(ns.members).map(([member, value]) => {
    if (typeof value !== 'function') return { name: member, kind: 'constant', type: NUMBER, detail: 'number' } satisfies Member;
    const returns: TypeRef =
      name === 'Object' ? (member === 'keys' ? { k: 'array', of: STRING } : { k: 'array', of: ANY })
      : name === 'Array' || member.startsWith('is') ? BOOLEAN
      : NUMBER;
    return { name: member, kind: 'function', type: ANY, returns, detail: `${name}.${member}(…)` } satisfies Member;
  });
}

function membersOf(type: TypeRef, env: CompletionEnv): Member[] {
  switch (type.k) {
    case 'model': return modelMembers(type.name, env);
    case 'array': return arrayMembers(type.of);
    case 'object': return type.members;
    case 'namespace': return namespaceMembers(type.name);
    case 'string': return STRING_MEMBERS;
    case 'number': return NUMBER_MEMBERS;
    case 'boolean': return BOOLEAN_MEMBERS;
    case 'date': return DATE_MEMBERS;
    case 'regexp': return REGEXP_MEMBERS;
    default: return [];
  }
}

export function describe(type: TypeRef): string {
  switch (type.k) {
    case 'model': return type.name;
    case 'array': return `${describe(type.of)}[]`;
    case 'object': return type.name;
    case 'namespace': return type.name;
    case 'date': return 'Date';
    case 'regexp': return 'RegExp';
    default: return type.k;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What's in scope

const ENTITY_INFO: TypeRef = {
  k: 'object',
  name: 'EntityInfo',
  members: [prop('entityType', STRING, 'string', 'The model type name.'), prop('entity', ANY, 'any', 'The entity.')],
};

/** The variables of an expression, as the library sets them (see the file comment). */
export function scopeOf(site: ExpressionSite, env: CompletionEnv): Member[] {
  const modelType: TypeRef = site.modelType ? { k: 'model', name: site.modelType } : ANY;
  const propertyType = site.modelType && site.propertyName
    ? (modelMembers(site.modelType, env).find((p) => p.name === site.propertyName)?.type ?? ANY)
    : modelType;
  const isModelCondition = site.kind === 'modelCondition';

  const contextMembers: Member[] = [
    prop('model', modelType, describe(modelType), 'The model being validated.'),
    prop('modelType', STRING, 'string', 'The model type name.'),
    prop('isClient', BOOLEAN, 'boolean'),
    prop('isServer', BOOLEAN, 'boolean'),
    prop('metadata', ANY, 'ModelMetadata'),
    prop('expressionScope', ANY, 'object', 'The functions and values in scope (store, the app\'s own).'),
  ];
  if (!isModelCondition) {
    contextMembers.push(prop('messageTemplate', STRING, 'string'), prop('displayName', STRING, 'string'));
    if (site.propertyName) contextMembers.push(prop('propertyName', STRING, 'string', `'${site.propertyName}'`));
    else contextMembers.push(prop('propertyNames', { k: 'array', of: STRING }, 'string[]', 'The properties the rule\'s errors are about (propertyNames in the metadata).'));
    if (site.kind === 'expression') contextMembers.push(prop('value', propertyType, describe(propertyType)), prop('validatorName', STRING, 'string'));
    for (const key of site.contextKeys ?? []) {
      if (!contextMembers.some((c) => c.name === key)) contextMembers.push(prop(key, ANY, 'rule setting', 'From this rule\'s context in the metadata.'));
    }
  }
  const context: TypeRef = { k: 'object', name: 'context', members: contextMembers };

  const scope: Member[] = [
    { name: 'model', kind: 'variable', type: modelType, detail: describe(modelType), info: 'The model being validated.' },
  ];
  if (!isModelCondition) {
    scope.push({
      name: 'value',
      kind: 'variable',
      type: propertyType,
      detail: describe(propertyType),
      info: site.propertyName ? `The value of ${site.propertyName}.` : 'For a model-level rule, the model.',
    });
  } else {
    scope.push(
      { name: 'entityInfos', kind: 'variable', type: { k: 'array', of: ENTITY_INFO }, detail: 'EntityInfo[]', info: 'All entities being validated: { entityType, entity }. On the server it is called entities.' },
      { name: 'findEntity', kind: 'function', type: ANY, returns: ANY, detail: '(id, type) → entity', info: "findEntity(model.parentId, 'Order'): the entity of that type and id among those being validated." },
    );
  }
  scope.push(
    { name: 'context', kind: 'variable', type: context, detail: 'context', info: 'The validation context. It may hold more: values from context providers and the validator.' },
    { name: 'isClient', kind: 'variable', type: BOOLEAN, detail: 'boolean', info: 'True in the browser.' },
    { name: 'isServer', kind: 'variable', type: BOOLEAN, detail: 'boolean', info: 'True on the .NET server.' },
    { name: 'store', kind: 'function', type: ANY, returns: { k: 'array', of: ANY }, detail: "(type) → entities[]", info: "store('Address'): the entities of a type, from the entity store. Available when validating an entity store, with options.store, or with installBreezeValidators." },
  );
  for (const fn of env.functions) {
    if (scope.some((s) => s.name === fn.name)) continue;
    scope.push({
      name: fn.name,
      kind: fn.params ? 'function' : 'variable',
      type: fn.params ? ANY : typeFromText(fn.returns, env.catalog),
      returns: typeFromText(fn.returns, env.catalog),
      detail: fn.params ? `(${fn.params.join(', ')})${fn.returns ? ` → ${fn.returns}` : ''}` : (fn.returns ?? 'value'),
      info: [fn.description, `From ${fn.sourceFile}.`].filter(Boolean).join(' '),
    });
  }
  for (const name of Object.keys(DEFAULT_GLOBALS)) {
    const value = DEFAULT_GLOBALS[name];
    if (value instanceof SafeNamespace) {
      scope.push({ name, kind: 'type', type: { k: 'namespace', name }, returns: name === 'Number' ? NUMBER : name === 'String' ? STRING : name === 'Boolean' ? BOOLEAN : ANY, detail: 'namespace', info: NAMESPACE_DOCS[name] });
    } else if (typeof value === 'function') {
      scope.push({ name, kind: 'function', type: ANY, returns: name.startsWith('is') ? BOOLEAN : NUMBER, detail: `${name}(…)` });
    } else {
      scope.push({ name, kind: 'constant', type: NUMBER, detail: 'number' });
    }
  }
  for (const keyword of ['true', 'false', 'null', 'undefined', 'typeof']) scope.push({ name: keyword, kind: 'keyword', type: ANY });
  return scope;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the text before the cursor

/** The text before the cursor with string, template and regex contents blanked, or undefined inside a literal. */
function codeOnly(text: string): { code: string; inString?: { quote: string; start: number } } {
  let code = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = i;
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return { code: code + ch, inString: { quote: ch, start } };
      code += ch + ' '.repeat(j - i - 1) + ch;
      i = j + 1;
    } else {
      code += ch;
      i++;
    }
  }
  return { code };
}

/** The receiver before a `.`: scans back over a member chain, balancing brackets. */
function chainBefore(code: string, dot: number): string {
  let depth = 0;
  let i = dot - 1;
  for (; i >= 0; i--) {
    const ch = code[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && !/[\w$.?]/.test(ch)) {
      // `new Date(...)` belongs to the chain
      if (ch === ' ' && /\bnew$/.test(code.slice(0, i))) {
        i -= 3;
        continue;
      }
      break;
    }
  }
  return code.slice(i + 1, dot).replace(/\?$/, '');
}

interface Segment {
  name?: string;
  call?: string; // argument text of a call
  index?: true;
}

function splitChain(chain: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  const text = chain.replace(/^new\s+/, '');
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.' || ch === '?') {
      i++;
      continue;
    }
    if (ch === '(' || ch === '[') {
      const close = ch === '(' ? ')' : ']';
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === ch) depth++;
        else if (text[j] === close && --depth === 0) break;
      }
      if (ch === '(') segments.push({ call: text.slice(i + 1, j) });
      else segments.push({ index: true });
      i = j + 1;
      continue;
    }
    const match = /^[\w$]+/.exec(text.slice(i));
    if (!match) return [];
    segments.push({ name: match[0] });
    i += match[0].length;
  }
  return segments;
}

/** The index-th string literal in the original text of a chain (strings are blanked in the code). */
function stringArgument(original: string, index: number): string | undefined {
  return [...original.matchAll(/(['"])([^'"]*)\1/g)][index]?.[2];
}

function resolveChain(chain: string, originalChain: string, scope: Member[], env: CompletionEnv): TypeRef {
  const segments = splitChain(chain);
  if (segments.length === 0 || !segments[0].name) return ANY;
  const rootName = segments[0].name;
  let type: TypeRef;
  let literalIndex = 0;
  const root = scope.find((s) => s.name === rootName);
  if (!root) return ANY;
  type = root.type;
  let callable: Member | undefined = root;
  for (const segment of segments.slice(1)) {
    if (segment.call !== undefined) {
      // store('X') -> X[]; findEntity(id, 'X') -> X; new Date(...) -> Date; other calls -> declared return type
      const literals = (segment.call.match(/(['"])\s*\1/g) ?? []).length;
      if (callable?.name === 'store' && root === callable) {
        const typeName = stringArgument(originalChain, literalIndex);
        type = typeName && (env.catalog.has(typeName) || env.doc[typeName]) ? { k: 'array', of: { k: 'model', name: typeName } } : { k: 'array', of: ANY };
      } else if (callable?.name === 'findEntity' && root === callable) {
        const typeName = stringArgument(originalChain, literalIndex);
        type = typeName ? { k: 'model', name: typeName } : ANY;
      } else if (rootName === 'Date' && callable === root) {
        type = DATE;
      } else {
        type = callable?.returns ?? ANY;
      }
      literalIndex += literals;
      callable = undefined;
    } else if (segment.index) {
      type = type.k === 'array' ? type.of : ANY;
      callable = undefined;
    } else {
      const member = membersOf(type, env).find((x) => x.name === segment.name);
      if (!member) return ANY;
      callable = member;
      type = member.kind === 'method' || member.kind === 'function' ? ANY : member.type;
    }
  }
  return callable && (callable.kind === 'method' || callable.kind === 'function') ? ANY : type;
}

/** Parameters of arrow functions the cursor is inside: `addresses.some(a => a.` makes `a` an address. */
function arrowParameters(code: string, original: string, scope: Member[], env: CompletionEnv): Member[] {
  const params: Member[] = [];
  const open: number[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '(') open.push(i);
    else if (code[i] === ')') open.pop();
  }
  for (const paren of open) {
    const callee = chainBefore(code, paren); // e.g. "store('Address').some"
    const method = /\.([\w$]+)$/.exec(callee)?.[1];
    if (!method) continue;
    const receiverText = callee.slice(0, callee.length - method.length - 1);
    const receiver = resolveChain(receiverText, original.slice(paren - callee.length, paren - method.length - 1), [...scope, ...params], env);
    const element = receiver.k === 'array' ? receiver.of : ANY;
    const after = code.slice(paren + 1);
    const arrow = /^\s*(?:\(\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)|([\w$]+))\s*=>/.exec(after);
    if (!arrow) continue;
    const first = arrow[1] ?? arrow[3];
    const second = arrow[2];
    if (method === 'reduce' || method === 'reduceRight') {
      params.push({ name: first, kind: 'variable', type: ANY, detail: 'accumulator' });
      if (second) params.push({ name: second, kind: 'variable', type: element, detail: describe(element) });
    } else if (method === 'toSorted') {
      params.push({ name: first, kind: 'variable', type: element, detail: describe(element) });
      if (second) params.push({ name: second, kind: 'variable', type: element, detail: describe(element) });
    } else if (ELEMENT_CALLBACKS.has(method)) {
      params.push({ name: first, kind: 'variable', type: element, detail: describe(element), info: `An element of ${receiverText}.` });
      if (second) params.push({ name: second, kind: 'variable', type: NUMBER, detail: 'index' });
    }
  }
  return params.reverse(); // innermost first, so it shadows
}

/** Completions at `pos` in `text`, or null where there's nothing to offer. */
export function complete(text: string, pos: number, site: ExpressionSite, env: CompletionEnv): CompletionResult | null {
  const before = text.slice(0, pos);
  const { code, inString } = codeOnly(before);

  if (inString) {
    // store('Ad|  or  findEntity(id, 'Ad|  ->  model type names
    const head = code.slice(0, inString.start);
    if (/\bstore\(\s*$/.test(head) || /\bfindEntity\([^()]*,\s*$/.test(head)) {
      const types = [...new Set([...env.catalog.keys(), ...Object.keys(env.doc).filter((k) => k !== 'global' && !k.startsWith('$'))])].sort();
      return { from: inString.start + 1, options: types.map((name) => ({ name, kind: 'type', type: ANY, detail: env.catalog.get(name)?.kinds.join(', ') ?? 'in the metadata' })) };
    }
    return null;
  }

  const scope = scopeOf(site, env);
  const params = arrowParameters(code, before, scope, env);
  const fullScope = [...params, ...scope.filter((s) => !params.some((p) => p.name === s.name))];

  const member = /(\?\.|\.)\s*([\w$]*)$/.exec(code);
  if (member) {
    const dot = code.length - member[0].length;
    if (/\d$/.test(code.slice(0, dot)) && member[1] === '.') return null; // a number: 1.5
    const chain = chainBefore(code, dot + (member[1] === '?.' ? 1 : 0));
    const type = resolveChain(chain, before.slice(dot - chain.length, dot), fullScope, env);
    const options = membersOf(type, env);
    return options.length ? { from: pos - member[2].length, options } : null;
  }

  const word = /[\w$]*$/.exec(code)![0];
  const previous = code.slice(0, code.length - word.length).trimEnd();
  if (/[\w$)\]]$/.test(previous) && !/\b(typeof|new)$/.test(previous)) return null; // after a value: an operator comes next
  if (/\bnew$/.test(previous)) return { from: pos - word.length, options: [{ name: 'Date', kind: 'type', type: DATE, detail: 'new Date(…)', info: 'Date is the only constructor expressions allow.' }] };
  return { from: pos - word.length, options: fullScope };
}

/** A one-line hint for an expression field: the variables it has. */
export function siteSummary(site: ExpressionSite): string {
  const variables = site.kind === 'modelCondition'
    ? 'model, entityInfos, findEntity(id, type), context, isClient, isServer, store(type)'
    : 'model, value, context, isClient, isServer, store(type)';
  return `Variables: ${variables}, plus the app's own functions. Ctrl+Space lists them.`;
}
