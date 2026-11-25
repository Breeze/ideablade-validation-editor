// Sources: files the editor reads to know the application. Breeze metadata (entities), and TypeScript or C# files:
// their view models, DTOs and form models, and the application's own validators and expression functions. With them
// the editor offers real model, property, validator and function names instead of free text. Each source is read
// again when it changes on disk.

export type SourceKind = 'breeze' | 'ts' | 'cs';

export interface SourceProperty {
  name: string;
  /** The type as the source writes it: Breeze's data type, or the TS / C# type text. */
  type: string;
  nullable?: boolean;
  maxLength?: number;
  /** A Breeze navigation property, or a property whose type is another known model. */
  navigation?: boolean;
  /** Hints from the source: Breeze validators, C# attributes. Informational. */
  notes?: string[];
}

export interface SourceModel {
  name: string;
  kind: string; // entity, complex type, interface, class, type, record, struct
  properties: SourceProperty[];
  /** Base type name, resolved against all loaded sources (TS `extends`, C# base class). */
  base?: string;
}

/** A validator the application registers itself, found in a TS or C# file. */
export interface SourceValidator {
  name: string;
  /** Registered as an asynchronous / synchronous validator (both when the file has both). */
  async: boolean;
  sync: boolean;
  defaultMessage?: string;
  /** Context settings its code reads: ctx.factor, context.GetValue<int>("maxLength"), ... */
  settings: string[];
  /** Setting types where the code says (C# GetValue<T>): 'integer', 'number', 'boolean', 'values', 'text'. */
  settingKinds?: Record<string, string>;
  description?: string;
}

/** A function or value the application adds to the expression scope (expressionScope, AddExpressionFunction). */
export interface SourceFunction {
  name: string;
  /** Parameters, for a function; undefined for a value. */
  params?: string[];
  returns?: string;
  description?: string;
  /** Set by the editor: the file it's from. */
  sourceFile?: string;
}

export interface ModelSource {
  path: string;
  kind: SourceKind;
  models: SourceModel[];
  validators?: SourceValidator[];
  functions?: SourceFunction[];
  error?: string;
  loadedAt: number;
}

export interface SourceOptions {
  /** Convert PascalCase server names (Breeze `nameOnServer`, C# properties) to camelCase. Default true. */
  camelCase: boolean;
}

export function sourceKindOf(path: string): SourceKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'ts';
  if (lower.endsWith('.cs')) return 'cs';
  return 'breeze';
}

export function camelCase(name: string): string {
  // Like Breeze's camelCase convention: lower-case the first letter only (and a leading acronym like "ID" -> "id").
  const match = /^[A-Z]+(?=[A-Z][a-z]|$)/.exec(name);
  if (match && match[0].length > 1) return match[0].toLowerCase() + name.slice(match[0].length);
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * Reads a model source. TypeScript files are parsed by the main process (the compiler needs Node; see
 * electron/typescript/models.ts), which passes the models along with the text.
 */
export function parseSource(
  path: string,
  text: string,
  options: SourceOptions,
  parsed?: { models?: SourceModel[]; validators?: SourceValidator[]; functions?: SourceFunction[]; parseError?: string },
): ModelSource {
  const kind = sourceKindOf(path);
  try {
    if (kind === 'ts') {
      if (parsed?.parseError) throw new Error(parsed.parseError);
      if (!parsed?.models) throw new Error('TypeScript files can only be read in the desktop app.');
      return { path, kind, models: parsed.models, validators: parsed.validators ?? [], functions: parsed.functions ?? [], loadedAt: Date.now() };
    }
    if (kind === 'cs') return { path, kind, models: parseCSharp(text, options), ...parseCSharpApp(text), loadedAt: Date.now() };
    return { path, kind, models: parseBreeze(text, options), loadedAt: Date.now() };
  } catch (e) {
    return { path, kind, models: [], error: (e as Error).message, loadedAt: Date.now() };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Breeze metadata

interface BreezeDataProperty {
  name?: string;
  nameOnServer?: string;
  dataType?: string;
  complexTypeName?: string;
  isNullable?: boolean;
  maxLength?: number;
  isPartOfKey?: boolean;
  validators?: { name: string }[];
}

interface BreezeNavigationProperty {
  name?: string;
  nameOnServer?: string;
  entityTypeName?: string;
  isScalar?: boolean;
}

interface BreezeStructuralType {
  shortName: string;
  namespace?: string;
  isComplexType?: boolean;
  baseTypeName?: string;
  dataProperties?: BreezeDataProperty[];
  navigationProperties?: BreezeNavigationProperty[];
}

/** Breeze's native metadata format, as a Breeze server's Metadata endpoint returns it (possibly as a JSON string). */
export function parseBreeze(text: string, options: SourceOptions): SourceModel[] {
  let json: unknown = JSON.parse(text);
  if (typeof json === 'string') json = JSON.parse(json); // the endpoint returns the metadata as a JSON string
  const types = (json as { structuralTypes?: BreezeStructuralType[] })?.structuralTypes;
  if (!Array.isArray(types)) {
    throw new Error("Not Breeze metadata: there is no 'structuralTypes' array. Breeze's native JSON metadata format is expected.");
  }
  const clientName = (p: { name?: string; nameOnServer?: string }) =>
    p.name ?? (options.camelCase ? camelCase(p.nameOnServer ?? '') : (p.nameOnServer ?? ''));
  const shortName = (typeName?: string) => typeName?.split(':#')[0];

  return types.map((t) => ({
    name: t.shortName,
    kind: t.isComplexType ? 'complex type' : 'entity',
    base: shortName(t.baseTypeName),
    properties: [
      ...(t.dataProperties ?? []).map((p) => ({
        name: clientName(p),
        type: p.dataType ?? shortName(p.complexTypeName) ?? 'complex',
        nullable: p.isNullable,
        maxLength: p.maxLength,
        notes: [
          ...(p.isPartOfKey ? ['key'] : []),
          ...(p.validators ?? []).map((v) => v.name).filter((n) => n !== 'maxLength'),
          ...(p.maxLength != null ? [`maxLength ${p.maxLength}`] : []),
        ],
      })),
      ...(t.navigationProperties ?? []).map((p) => ({
        name: clientName(p),
        type: (shortName(p.entityTypeName) ?? '?') + (p.isScalar === false ? '[]' : ''),
        navigation: true,
      })),
    ],
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// C#

/**
 * Classes, records and structs, with their public properties and a record's positional parameters. A lightweight
 * reader, not a compiler: enough for DTOs and view models. Interfaces are left out, since their members are
 * implemented by the classes that are listed anyway.
 */
export function parseCSharp(text: string, options: SourceOptions): SourceModel[] {
  const code = blankCommentsAndStrings(text);
  const depthAt = depthMap(code);
  const name = (n: string) => (options.camelCase ? camelCase(n) : n);
  const models: SourceModel[] = [];

  const declaration =
    /\b(class|record\s+struct|record\s+class|record|struct)\s+([A-Za-z_]\w*)\s*(<[^>{(]*>)?\s*(\(([^)]*)\))?\s*(?::\s*([^{;]+?))?\s*(?:where\s[^{;]*)?([{;])/g;
  for (const match of code.matchAll(declaration)) {
    const [, keyword, typeName, , , parameters, baseList, terminator] = match;
    if (/^\s*(Validator|SyncValidator|AsyncValidator)\b/.test(baseList ?? '')) continue; // read as a validator (parseCSharpApp)
    const start = match.index!;
    const prefix = code.slice(Math.max(0, start - 80), start);
    if (/\b(private|protected|static)\s+(\w+\s+)*$/.test(prefix) && !/\bpublic\b/.test(prefix.split(/[;{}]/).pop() ?? '')) continue;

    const properties: SourceProperty[] = [];
    if (parameters) {
      for (const parameter of splitTopLevel(parameters, ',')) {
        const p = /([\w<>\[\],.?\s]+?)\s+([A-Za-z_]\w*)\s*(=.*)?$/.exec(parameter.replace(/\[[^\]]*\]/g, '').trim());
        if (p) properties.push({ name: name(p[2]), type: p[1].trim(), nullable: p[1].trim().endsWith('?') });
      }
    }

    if (terminator === '{') {
      const bodyStart = start + match[0].length; // just after '{'
      const bodyDepth = depthAt[bodyStart];
      const end = findClose(code, bodyStart - 1);
      const body = code.slice(bodyStart, end);
      const property =
        /\bpublic\s+((?:(?:virtual|override|required|new|sealed|abstract)\s+)*)([\w<>\[\],.?]+(?:\s*<[^>]*>)?(?:\[\])?\??)\s+([A-Za-z_]\w*)\s*(\{|=>)/g;
      for (const p of body.matchAll(property)) {
        if (depthAt[bodyStart + p.index!] !== bodyDepth) continue; // a nested type's property
        if (/^static\b/.test(p[1])) continue;
        const attributes = attributesBefore(text, bodyStart + p.index!);
        const type = p[2].replace(/\s+/g, '');
        const maxLength = /\b(?:MaxLength|StringLength)\((\d+)/.exec(attributes.join(' '))?.[1];
        properties.push({
          name: name(p[3]),
          type,
          nullable: type.endsWith('?'),
          maxLength: maxLength ? Number(maxLength) : undefined,
          notes: attributes.length ? attributes : undefined,
        });
      }
    }

    const base = baseList?.split(',')[0]?.trim().replace(/<.*$/, '').replace(/\(.*$/, '');
    models.push({
      name: typeName,
      kind: keyword.replace(/\s+/g, ' '),
      base: base && !/^I[A-Z]/.test(base) ? base : undefined,
      properties,
    });
  }
  return models;
}

const CS_STANDARD_CONTEXT_KEYS = new Set(['model', 'modeltype', 'propertyname', 'propertynames', 'displayname', 'messagetemplate', 'value', 'validatorname', 'isclient', 'isserver', 'exception']);

function settingKind(clrType: string | undefined, many: boolean): string {
  if (many) return 'values';
  switch ((clrType ?? '').replace(/\?$/, '').replace(/^System\./, '').toLowerCase()) {
    case 'int': case 'int32': case 'long': case 'int64': case 'short': case 'byte': return 'integer';
    case 'decimal': case 'double': case 'float': case 'single': return 'number';
    case 'bool': case 'boolean': return 'boolean';
    case 'string': return 'text';
    default: return 'bound';
  }
}

/**
 * The application's validators and expression functions in a C# file: classes deriving from `Validator`,
 * `SyncValidator` or `AsyncValidator` (their `base("name", ...)`, `WithMessage(context, "...")` and the settings
 * they read with `GetValue<T>("x")`, `GetValues<T>("x")` or `context["x"]`), `new ValidatorFactory("name", ...)`
 * registrations, and `AddExpressionFunction("name", ...)`.
 */
export function parseCSharpApp(text: string): { validators: SourceValidator[]; functions: SourceFunction[] } {
  const code = blankCommentsAndStrings(text); // for structure; strings and comments are read from `text`
  const withStrings = text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const validators: SourceValidator[] = [];
  const functions: SourceFunction[] = [];
  const classes = new Map<string, SourceValidator>();

  for (const match of code.matchAll(/\bclass\s+([A-Za-z_]\w*)[^{;]*?:\s*(Validator|SyncValidator|AsyncValidator)\b[^{]*\{/g)) {
    const start = match.index! + match[0].length - 1;
    const body = withStrings.slice(start, findClose(code, start));
    const settings = new Map<string, string>();
    for (const s of body.matchAll(/\bGetValue(s)?\s*(?:<([^>]+)>)?\s*\(\s*"([^"]+)"/g)) settings.set(s[3], settingKind(s[2], !!s[1]));
    for (const s of body.matchAll(/\b(?:context|ctx|Context)\s*\[\s*"([^"]+)"\s*\]/g)) if (!settings.has(s[1])) settings.set(s[1], 'bound');
    const keys = [...settings.keys()].filter((k) => !CS_STANDARD_CONTEXT_KEYS.has(k.toLowerCase()));
    classes.set(match[1], {
      name: /\bbase\s*\(\s*"([^"]+)"/.exec(body)?.[1] ?? '',
      async: match[2] === 'AsyncValidator',
      sync: match[2] !== 'AsyncValidator',
      defaultMessage: /\bWithMessage\s*\([^,]*,\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1],
      settings: keys,
      settingKinds: Object.fromEntries(keys.map((k) => [k, settings.get(k)!])),
      description: xmlSummaryBefore(text, match.index!),
    });
  }

  const add = (v: SourceValidator) => {
    if (!v.name) return;
    const existing = validators.find((x) => x.name === v.name);
    if (!existing) validators.push({ ...v });
    else {
      existing.async ||= v.async;
      existing.sync ||= v.sync;
      existing.defaultMessage ??= v.defaultMessage;
      existing.settings = [...new Set([...existing.settings, ...v.settings])];
      existing.settingKinds = { ...v.settingKinds, ...existing.settingKinds };
    }
  };
  for (const f of withStrings.matchAll(/\bnew\s+ValidatorFactory\s*\(\s*"([^"]+)"\s*,([^;]*)/g)) {
    const cls = classes.get(/\bnew\s+([A-Za-z_]\w*)/.exec(f[2])?.[1] ?? '');
    add({ ...(cls ?? { async: false, sync: true, settings: [] }), name: f[1] });
  }
  for (const cls of classes.values()) add(cls);

  for (const f of withStrings.matchAll(/\bAddExpressionFunction\s*\(\s*"([^"]+)"\s*,\s*([^;]*)/g)) {
    const func = /\(\s*(?:Func|System\.Func)\s*<([^>]*(?:<[^>]*>[^>]*)*)>\s*\)/.exec(f[2]);
    const lambda = /\(?\s*([\w\s,<>?]*?)\)?\s*=>/.exec(f[2]);
    let params: string[] = [];
    let returns: string | undefined;
    if (func) {
      const types = splitTopLevel(func[1], ',').map((t) => t.trim());
      returns = types.pop();
      const names = lambda ? lambda[1].split(',').map((n) => n.trim().split(/\s+/).pop()!).filter(Boolean) : [];
      params = types.map((t, i) => (names[i] ? `${names[i]}: ${t}` : t));
    } else if (lambda) {
      params = lambda[1].split(',').map((p) => p.trim()).filter(Boolean);
    }
    functions.push({ name: f[1], params, returns, description: 'AddExpressionFunction' });
  }
  return { validators, functions };
}

/** The `/// <summary>` just above a declaration, as plain text. */
function xmlSummaryBefore(text: string, index: number): string | undefined {
  const lines = text.slice(0, index).split('\n');
  lines.pop();
  const doc: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('///')) doc.unshift(line.slice(3).trim());
    else if (line.startsWith('[') || line === '') continue;
    else break;
  }
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(doc.join(' '))?.[1];
  return summary?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined;
}

/** Replaces comments and string contents with spaces, keeping offsets, so braces in them don't count. */
function blankCommentsAndStrings(text: string): string {
  return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|@"(?:[^"]|"")*"|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)'/g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
}

function depthMap(code: string): Int32Array {
  const depth = new Int32Array(code.length + 1);
  let d = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') d++;
    depth[i] = d;
    if (code[i] === '}') d--;
  }
  depth[code.length] = d;
  return depth;
}

function findClose(code: string, open: number): number {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') d++;
    else if (code[i] === '}' && --d === 0) return i;
  }
  return code.length;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** The `[Attribute]`s on the lines just above a member (from the original text, so string arguments stay). */
function attributesBefore(text: string, index: number): string[] {
  const before = text.slice(0, index).split('\n');
  before.pop(); // the member's own line
  const attributes: string[] = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i].trim();
    if (line.startsWith('[')) attributes.unshift(line.replace(/^\[|\]$/g, ''));
    else if (line.startsWith('//') || line === '') continue;
    else break;
  }
  return attributes;
}

// ---------------------------------------------------------------------------------------------------------------
// The catalog: every model the loaded sources know, with inherited properties.

export interface CatalogModel {
  name: string;
  kinds: string[];
  sources: string[];
  properties: SourceProperty[];
}

export type Catalog = Map<string, CatalogModel>;

export function buildCatalog(sources: readonly ModelSource[]): Catalog {
  const byName = new Map<string, { models: SourceModel[]; sources: string[] }>();
  for (const source of sources) {
    for (const model of source.models) {
      const entry = byName.get(model.name) ?? { models: [], sources: [] };
      entry.models.push(model);
      if (!entry.sources.includes(source.path)) entry.sources.push(source.path);
      byName.set(model.name, entry);
    }
  }

  const catalog: Catalog = new Map();
  const resolve = (name: string, seen: Set<string>): SourceProperty[] => {
    const entry = byName.get(name);
    if (!entry || seen.has(name)) return [];
    seen.add(name);
    const properties: SourceProperty[] = [];
    const add = (p: SourceProperty) => {
      if (!properties.some((q) => q.name === p.name)) properties.push(p);
    };
    for (const model of entry.models) model.properties.forEach(add);
    for (const model of entry.models) if (model.base) resolve(model.base, seen).forEach(add);
    return properties;
  };
  for (const [name, entry] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    catalog.set(name, {
      name,
      kinds: [...new Set(entry.models.map((m) => m.kind))],
      sources: entry.sources,
      properties: resolve(name, new Set()),
    });
  }
  return catalog;
}

/** What kind of value a property holds, as far as validation goes. */
export type ValueKind = 'text' | 'number' | 'true/false' | 'date';

/**
 * The kind of value a property's type stands for, whichever source wrote it: Breeze's data types (`String`, `Int32`,
 * `Boolean`, `DateTime`, `Guid`), TypeScript (`string`, `number | null`, `Date`) or C# (`string`, `int?`, `bool`,
 * `DateTimeOffset`, `Guid`). A Guid counts as text: it's a string in TypeScript. Undefined for anything else (a
 * model, an array, a union of kinds, an enum), which isn't compared.
 */
export function valueKind(type: string | undefined): ValueKind | undefined {
  if (!type) return undefined;
  const parts = type
    .split('|')
    .map((t) => t.trim().replace(/\?$/, '').replace(/^System\./, '').toLowerCase())
    .filter((t) => t && t !== 'null' && t !== 'undefined');
  const kinds = new Set(parts.map(kindOf));
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

function kindOf(type: string): ValueKind | undefined {
  if (['string', 'guid', 'char'].includes(type)) return 'text';
  if (['number', 'int', 'long', 'short', 'byte', 'sbyte', 'uint', 'ulong', 'ushort', 'float', 'double', 'decimal', 'single'].includes(type)) return 'number';
  if (/^u?int(16|32|64)$/.test(type)) return 'number';
  if (['boolean', 'bool'].includes(type)) return 'true/false';
  if (['date', 'datetime', 'datetimeoffset', 'dateonly'].includes(type)) return 'date';
  return undefined;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The application's validators from all sources, merged by name. */
export function appValidators(sources: readonly ModelSource[]): (SourceValidator & { sourceFile: string })[] {
  const result: (SourceValidator & { sourceFile: string })[] = [];
  for (const source of sources) {
    for (const v of source.validators ?? []) {
      const existing = result.find((x) => x.name === v.name);
      if (!existing) result.push({ ...v, sourceFile: fileName(source.path) });
      else {
        existing.async ||= v.async;
        existing.sync ||= v.sync;
        existing.defaultMessage ??= v.defaultMessage;
        existing.description ??= v.description;
        existing.settings = [...new Set([...existing.settings, ...v.settings])];
        existing.settingKinds = { ...v.settingKinds, ...existing.settingKinds };
        if (!existing.sourceFile.includes(fileName(source.path))) existing.sourceFile += `, ${fileName(source.path)}`;
      }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** The application's expression functions and values from all sources. */
export function appFunctions(sources: readonly ModelSource[]): SourceFunction[] {
  const result: SourceFunction[] = [];
  for (const source of sources) {
    for (const f of source.functions ?? []) {
      if (!result.some((x) => x.name === f.name)) result.push({ ...f, sourceFile: fileName(source.path) });
    }
  }
  return result;
}
