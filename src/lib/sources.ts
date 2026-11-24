// Model sources: files that describe the shape of the models the metadata has rules for, so the editor can offer
// real model and property names instead of free text. Breeze metadata (entities), and TypeScript or C# files (view
// models, DTOs, form models). Each is read again when it changes on disk.

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

export interface ModelSource {
  path: string;
  kind: SourceKind;
  models: SourceModel[];
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
 * electron/typescript-models.cjs), which passes the models along with the text.
 */
export function parseSource(
  path: string,
  text: string,
  options: SourceOptions,
  parsed?: { models?: SourceModel[]; parseError?: string },
): ModelSource {
  const kind = sourceKindOf(path);
  try {
    if (kind === 'ts') {
      if (parsed?.parseError) throw new Error(parsed.parseError);
      if (!parsed?.models) throw new Error('TypeScript files can only be read in the desktop app.');
      return { path, kind, models: parsed.models, loadedAt: Date.now() };
    }
    const models = kind === 'cs' ? parseCSharp(text, options) : parseBreeze(text, options);
    return { path, kind, models, loadedAt: Date.now() };
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

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
