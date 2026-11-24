// Checks a metadata document as the user edits it:
//  1. against the JSON Schema the library ships (precompiled, see scripts/build-schema-validator.mjs);
//  2. with the library itself, for what the schema can't see: unknown validator names, expressions that don't
//     parse, `extends` / `from` that lead nowhere, and rules whose errors would share a key
//     (ModelMetadata.checkErrorKeys, which the service runs before it first validates a model type);
//  3. against the model sources (Breeze metadata, TS, C#): model types and properties that don't exist there.

import {
  type RuleSource,
  type ValidatorFactory,
  ValidationMetadata,
  asyncValidator,
  checkExpression,
  defaultValidators,
  syncValidator,
} from 'ideablade-validation';

import validateSchema from '../generated/schema-validator';
import { BUILT_IN_NAMES } from './catalog';
import {
  type GroupEntry,
  type Json,
  type MetadataDoc,
  type ModelEntry,
  type Path,
  type RuleEntry,
  type ValidatorEntry,
  type ValidatorObject,
  isGroup,
  isModelKey,
  isPlainObject,
  mergeDocs,
  modelKeys,
} from './doc';
import type { Catalog, SourceValidator } from './sources';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  path: Path;
  message: string;
  origin: 'schema' | 'library' | 'models';
}

export interface CheckOptions {
  /** Validator names the application registers itself, beyond the built-in ones. */
  customValidators: readonly string[];
  catalog: Catalog;
  /** The application's validators found in the sources, for checking `async`. */
  appValidators?: readonly (SourceValidator & { sourceFile?: string })[];
  /**
   * All open metadata documents, in load order, this one included. The library merges them, so model types,
   * properties, `extends` and `from` resolve across them, and the error key check sees all of a model's rules.
   */
  workspace?: readonly MetadataDoc[];
}

/** Regular expression flags for `pattern`, as both implementations treat them. */
export const REGEX_FLAGS: { flag: string; label: string; help: string }[] = [
  { flag: 'i', label: 'ignore case', help: 'Upper and lower case match each other.' },
  { flag: 'm', label: 'multiline', help: '^ and $ match at the start and end of each line, not only of the whole value.' },
  { flag: 's', label: 'dotAll', help: '. also matches line breaks.' },
  { flag: 'u', label: 'unicode', help: 'Unicode-aware matching in JavaScript (\\u{...}, \\p{...}). .NET accepts it and matches as usual.' },
];

/** Problems with a pattern's flags: letters JavaScript rejects, and flags that don't do what one would expect. */
export function checkRegexFlags(flags: string): { severity: Severity; message: string }[] {
  const problems: { severity: Severity; message: string }[] = [];
  const invalid = [...new Set(flags.split('').filter((f) => !'dgimsuvy'.includes(f)))];
  if (invalid.length) problems.push({ severity: 'error', message: `Not a regular expression flag: ${invalid.join(', ')}. Use ${REGEX_FLAGS.map((f) => f.flag).join(', ')}.` });
  const repeated = [...new Set(flags.split('').filter((f, i) => flags.indexOf(f) !== i))];
  if (repeated.length) problems.push({ severity: 'error', message: `Flag given twice: ${repeated.join(', ')}.` });
  if (flags.includes('u') && flags.includes('v')) problems.push({ severity: 'error', message: "The 'u' and 'v' flags can't be combined." });
  if (flags.includes('g') || flags.includes('y')) {
    problems.push({ severity: 'warning', message: "Don't use 'g' or 'y': in JavaScript they make test() remember where it stopped, so a validator that runs twice can alternate between passing and failing. .NET ignores them." });
  }
  if (flags.includes('v')) problems.push({ severity: 'warning', message: "The 'v' flag is JavaScript-only; .NET doesn't know it, so client and server may match differently." });
  if (flags.includes('d')) problems.push({ severity: 'warning', message: "The 'd' flag only adds match indices; it doesn't change what matches." });
  return problems;
}

/** Stand-ins for validators the editor doesn't have (`breeze`, the app's own): they always pass. */
export function stubValidators(names: readonly string[]): ValidatorFactory[] {
  const known = new Set(defaultValidators.map((v) => v.name));
  return [...new Set(['breeze', ...names])]
    .filter((n) => !known.has(n))
    .flatMap((n) => [syncValidator(n, () => true), asyncValidator(n, () => true)]);
}

/**
 * A rule source that knows every property of the loaded model sources, so `from: "StaffingResource"` resolves when
 * StaffingResource comes from Breeze, as it does in the app through `breezeRuleSource`. It adds no rules.
 */
export function catalogRuleSource(catalog: Catalog): RuleSource {
  return {
    getPropertyRules: (modelType, propertyName) =>
      catalog.get(modelType)?.properties.some((p) => p.name === propertyName) ? {} : undefined,
  };
}

export function checkDocument(doc: MetadataDoc, options: CheckOptions): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, path: Path, message: string, origin: Issue['origin']) =>
    issues.push({ severity, path, message, origin });

  // 1. Schema
  if (!validateSchema(doc)) {
    for (const e of simplifySchemaErrors(validateSchema.errors ?? [])) {
      add('error', pointerToPath(e.instancePath), e.message, 'schema');
    }
  }

  // 2a. The rules themselves, with exact locations.
  const knownValidators = new Set([...BUILT_IN_NAMES, ...options.customValidators]);
  const workspace = options.workspace?.length ? options.workspace : [doc];
  const view = mergeDocs(workspace); // all open documents, as the library merges them
  const modelTypes = new Set([...modelKeys(view), ...options.catalog.keys()]);

  const propertiesOf = (modelType: string, seen = new Set<string>()): Set<string> => {
    const names = new Set<string>(options.catalog.get(modelType)?.properties.map((p) => p.name) ?? []);
    const entry = view[modelType];
    if (isPlainObject(entry) && !seen.has(modelType)) {
      seen.add(modelType);
      Object.keys(isPlainObject(entry['properties']) ? entry['properties'] : {}).forEach((n) => names.add(n));
      if (typeof entry['extends'] === 'string') propertiesOf(entry['extends'], seen).forEach((n) => names.add(n));
    }
    return names;
  };

  const checkExpr = (expression: Json | undefined, path: Path, what: string) => {
    if (typeof expression !== 'string' || expression === '') return;
    const result = checkExpression(expression);
    if (!result.valid) add('error', path, `${what} doesn't parse: ${result.error.message}`, 'library');
  };

  const checkValidator = (rule: ValidatorEntry, path: Path, modelType: string | undefined, propertyName: string | undefined) => {
    const name = typeof rule === 'string' ? rule : rule?.name;
    const namePath = typeof rule === 'string' ? path : [...path, 'name'];
    if (typeof name !== 'string' || !name) return; // the schema reports it
    if (!knownValidators.has(name)) {
      add('error', namePath, `Unknown validator '${name}'. If the application registers it, add the file that defines it as a source, or list it under Settings → Other validators.`, 'library');
    }
    const isAsync = typeof rule !== 'string' && isPlainObject(rule) && rule.async === true;
    const app = options.appValidators?.find((a) => a.name === name);
    if (app) {
      if (isAsync && !app.async) {
        add('error', [...path, 'async'], `'${name}' is registered as a synchronous validator (${app.sourceFile ?? 'source'}); remove async.`, 'library');
      } else if (!isAsync && !app.sync) {
        add('error', namePath, `'${name}' is registered as an asynchronous validator (${app.sourceFile ?? 'source'}); set async.`, 'library');
      }
    }
    if (typeof rule === 'string' || !isPlainObject(rule)) return;
    const v = rule as ValidatorObject;
    checkExpr(v.condition, [...path, 'condition'], 'The condition');
    const context = isPlainObject(v.context) ? v.context : {};
    if (name === 'expression') {
      if (typeof context['expression'] !== 'string' || !context['expression']) {
        add('error', [...path, 'context'], "An 'expression' validator needs context.expression.", 'library');
      }
      checkExpr(context['expression'], [...path, 'context', 'expression'], 'The expression');
    }
    if (name === 'pattern') {
      const pattern = context['expression'];
      if (typeof pattern !== 'string' || !pattern) {
        add('error', [...path, 'context'], "A 'pattern' validator needs context.expression (the pattern).", 'library');
      } else {
        const literal = /^\/(.*)\/([a-z]*)$/s.exec(pattern);
        const flags = literal ? literal[2] : typeof context['flags'] === 'string' ? context['flags'] : '';
        const flagsPath = literal ? [...path, 'context', 'expression'] : [...path, 'context', 'flags'];
        const flagProblems = checkRegexFlags(flags);
        flagProblems.filter((p) => p.severity === 'error').forEach((p) => add('error', flagsPath, p.message, 'library'));
        if (!flagProblems.some((p) => p.severity === 'error')) {
          try {
            new RegExp(literal ? literal[1] : pattern, flags);
          } catch (e) {
            add('error', [...path, 'context', 'expression'], `The pattern is not a valid regular expression: ${(e as Error).message}`, 'library');
          }
        }
        flagProblems.filter((p) => p.severity === 'warning').forEach((p) => add('warning', flagsPath, p.message, 'library'));
        if (literal && typeof context['flags'] === 'string' && context['flags']) {
          add('warning', [...path, 'context', 'flags'], "The pattern is written as /pattern/flags, so its own flags apply and context.flags is ignored.", 'library');
        }
      }
    }
    if ((name === 'range' || name === 'numericRange' || name === 'dateRange') && context['minValue'] == null && context['maxValue'] == null) {
      add('warning', [...path, 'context'], `'${name}' without minValue or maxValue accepts every value.`, 'library');
    }
    if ((name === 'minLength' || name === 'maxLength') && typeof context[name] !== 'number') {
      add('error', [...path, 'context'], `'${name}' needs context.${name}.`, 'library');
    }
    if (modelType) {
      const known = propertiesOf(modelType);
      if (Array.isArray(v.propertyNames)) {
        if (propertyName !== undefined) {
          add('warning', [...path, 'propertyNames'], 'propertyNames is for model-level rules; a property rule is about its own property.', 'library');
        }
        v.propertyNames.forEach((p, i) => {
          if (typeof p === 'string' && known.size > 0 && !known.has(p)) {
            add('warning', [...path, 'propertyNames', i], `'${modelType}' has no property '${p}' in the metadata or the model sources.`, 'models');
          }
        });
      }
      if (name === 'compare' && typeof context['other'] === 'string' && known.size > 0 && !known.has(context['other'])) {
        add('warning', [...path, 'context', 'other'], `'${modelType}' has no property '${context['other']}' in the metadata or the model sources.`, 'models');
      }
    }
  };

  const checkRules = (rules: unknown, path: Path, modelType: string | undefined, propertyName: string | undefined) => {
    if (!Array.isArray(rules)) return;
    rules.forEach((rule, i) => {
      if (isGroup(rule as RuleEntry)) {
        const group = rule as GroupEntry;
        if (!group.group) add('error', [...path, i, 'group'], 'A group needs a name.', 'library');
        (Array.isArray(group.validators) ? group.validators : []).forEach((v, j) =>
          checkValidator(v, [...path, i, 'validators', j], modelType, propertyName),
        );
      } else {
        checkValidator(rule as ValidatorEntry, [...path, i], modelType, propertyName);
      }
    });
  };

  if (isPlainObject(doc['global'])) checkRules(doc['global']['validators'], ['global', 'validators'], undefined, undefined);

  for (const modelType of modelKeys(doc)) {
    const entry = doc[modelType];
    if (!isPlainObject(entry)) continue;
    const model = entry as ModelEntry;
    checkExpr(model.condition, [modelType, 'condition'], 'The condition');
    if (typeof model.extends === 'string' && model.extends) {
      if (model.extends === modelType) add('error', [modelType, 'extends'], 'A model type cannot extend itself.', 'library');
      else if (!modelTypes.has(model.extends)) {
        add('warning', [modelType, 'extends'], `'${model.extends}' is neither in this metadata nor in the model sources; nothing is inherited.`, 'library');
      }
    }
    checkRules(model.validators, [modelType, 'validators'], modelType, undefined);

    const catalogModel = options.catalog.get(modelType);
    if (options.catalog.size > 0 && !catalogModel) {
      add('info', [modelType], `'${modelType}' is not in the model sources.`, 'models');
    }
    const properties = isPlainObject(model.properties) ? model.properties : {};
    const inherited = typeof model.extends === 'string' ? propertiesOf(model.extends) : new Set<string>();
    for (const [propertyName, property] of Object.entries(properties)) {
      const path: Path = [modelType, 'properties', propertyName];
      if (!isPlainObject(property)) continue;
      if (catalogModel && !catalogModel.properties.some((p) => p.name === propertyName) && !inherited.has(propertyName)) {
        add('warning', path, `'${modelType}' has no property '${propertyName}' in ${catalogModel.sources.map(shortName).join(', ')}.`, 'models');
      }
      const from = property['from'];
      if (typeof from === 'string' && from) {
        const [fromType, fromProperty = propertyName] = from.split('.');
        const fromKnown = propertiesOf(fromType).has(fromProperty);
        if (!fromKnown) {
          add(
            'error',
            [...path, 'from'],
            `'${fromType}.${fromProperty}' is neither in this metadata nor in the model sources. The library throws for a 'from' that nobody knows (unless a rule source, such as Breeze's, knows it).`,
            'library',
          );
        }
      }
      checkRules(property['validators'], [...path, 'validators'], modelType, propertyName);
    }
  }

  // 2b. The library's own configuration checks: error keys, extends / from chains, as the service would run them.
  const metadata = new ValidationMetadata({
    validators: [...defaultValidators, ...stubValidators(options.customValidators)],
    ruleSources: [catalogRuleSource(options.catalog)],
  });
  try {
    metadata.setMetadata(workspace as never);
  } catch (e) {
    add('error', [], `The library can't load the metadata: ${(e as Error).message}`, 'library');
    return issues;
  }
  for (const modelType of Object.keys(doc).filter(isModelKey)) {
    try {
      const model = metadata.getModelMetadata(modelType);
      model.checkErrorKeys();
    } catch (e) {
      const message = e instanceof RangeError ? `Circular 'extends' chain through '${modelType}'.` : (e as Error).message;
      // `from` problems are reported above with their location; don't repeat them.
      if (!message.includes('no rule source knows')) {
        add('error', [modelType], message, 'library');
      }
    }
  }
  return issues;
}

function shortName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** "/Person/properties/first~1name" -> ["Person", "properties", "first/name"] */
export function pointerToPath(pointer: string): Path {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

interface RawSchemaError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

/**
 * Ajv reports every branch of a `oneOf` (a validator list item may be a name, a validator or a group), which reads
 * badly. Keep the errors of the branch that got furthest, and say which keys are not allowed.
 */
function simplifySchemaErrors(errors: RawSchemaError[]): { instancePath: string; message: string }[] {
  const byPath = new Map<string, RawSchemaError[]>();
  for (const e of errors) byPath.set(e.instancePath, [...(byPath.get(e.instancePath) ?? []), e]);
  const result: { instancePath: string; message: string }[] = [];
  for (const [path, list] of byPath) {
    const deeper = [...byPath.keys()].some((p) => p !== path && p.startsWith(path + '/'));
    const meaningful = list.filter((e) => e.keyword !== 'oneOf' && e.keyword !== 'type' && e.keyword !== 'required');
    const chosen = meaningful.length ? meaningful : deeper ? [] : list.filter((e) => e.keyword !== 'oneOf').slice(0, 1);
    for (const e of chosen) {
      const message =
        e.keyword === 'additionalProperties'
          ? `'${String(e.params['additionalProperty'])}' is not allowed here`
          : e.keyword === 'enum'
            ? `${e.message}: ${(e.params['allowedValues'] as unknown[]).join(', ')}`
            : (e.message ?? e.keyword);
      if (!result.some((r) => r.instancePath === path && r.message === message)) result.push({ instancePath: path, message });
    }
    if (chosen.length === 0 && !deeper && list.length) result.push({ instancePath: path, message: list[0].message ?? 'invalid' });
  }
  return result;
}
