import { describe, expect, it } from 'vitest';

import breezeMetadata from '../../samples/temphire.breeze-metadata.json';
import tempHireMetadata from '../../samples/temphire.validation.metadata.json';
import { checkDocument, checkRegexFlags, serverUnsupported } from './check';
import { complete, typeFromText } from './completion';
import { insertCsMetadata, newCsMetadataFile, pascalCaseFromFile, readCsMetadata, writeCsMetadata } from './cs-metadata';
import { type MetadataDoc, lineOfPath, mergeDocs, setIn, stringify } from './doc';
import { COMMON_PATTERNS, analyzeRegex, regexTestKey, splitPattern, testSamples } from './regex';
import { buildCatalog, camelCase, parseBreeze, parseCSharp, parseCSharpApp, parseSource } from './sources';
import { runTest } from './tester';

const options = { camelCase: true };
const breezeSource = parseSource('temphire.breeze-metadata.json', JSON.stringify(breezeMetadata), options);
const catalog = buildCatalog([breezeSource]);
const doc = tempHireMetadata as unknown as MetadataDoc;
const errors = (d: MetadataDoc, custom: string[] = []) =>
  checkDocument(d, { customValidators: custom, catalog }).filter((i) => i.severity === 'error');

describe('model sources', () => {
  it('reads Breeze metadata, with camelCase client names', () => {
    expect(breezeSource.error).toBeUndefined();
    const resource = catalog.get('StaffingResource')!;
    expect(resource.kinds).toEqual(['entity']);
    expect(resource.properties.map((p) => p.name)).toEqual(expect.arrayContaining(['id', 'firstName', 'lastName']));
    expect(resource.properties.find((p) => p.name === 'addresses')?.navigation).toBe(true);
  });

  it('reads Breeze metadata delivered as a JSON string', () => {
    expect(parseBreeze(JSON.stringify(JSON.stringify(breezeMetadata)), options).length).toBe(breezeSource.models.length);
  });

  it('camel-cases like Breeze', () => {
    expect(camelCase('FirstName')).toBe('firstName');
    expect(camelCase('ID')).toBe('id');
    expect(camelCase('URLPath')).toBe('urlPath');
  });

  it('reads C# classes and records', () => {
    const models = parseCSharp(
      `namespace X;
      public class SignInModel : BaseModel
      {
          [Required, StringLength(100)]
          public string UserName { get; set; }
          public string? ReturnUrl { get; init; } // "{ not a brace"
          public List<SampleUser> SampleUsers { get; } = [];
          private string Secret { get; set; }
          public static int Count { get; set; }
          public string Shout() => UserName.ToUpper();
          private sealed class Nested { public int Hidden { get; set; } }
      }
      public record SampleUser(string UserName, string Role, int? Age = null);
      public abstract class BaseModel { public Guid Id { get; set; } }`,
      options,
    );
    const signIn = models.find((m) => m.name === 'SignInModel')!;
    expect(signIn.properties.map((p) => p.name)).toEqual(['userName', 'returnUrl', 'sampleUsers']);
    expect(signIn.properties[0].maxLength).toBe(100);
    expect(signIn.base).toBe('BaseModel');
    expect(models.find((m) => m.name === 'SampleUser')!.properties.map((p) => `${p.name}:${p.type}`)).toEqual([
      'userName:string',
      'role:string',
      'age:int?',
    ]);
    const merged = buildCatalog([{ path: 'a.cs', kind: 'cs', models, loadedAt: 0 }]);
    expect(merged.get('SignInModel')!.properties.map((p) => p.name)).toContain('id');
  });
});

describe('checks', () => {
  it("accepts TempHire's metadata", () => {
    expect(errors(doc)).toEqual([]);
  });

  it('reports schema errors with their location', () => {
    const issues = errors(setIn(doc, ['Address', 'properties', 'city', 'maxLength'], 'ten') as MetadataDoc);
    expect(issues).toContainEqual(expect.objectContaining({ origin: 'schema', path: ['Address', 'properties', 'city', 'maxLength'] }));
  });

  it('reports unknown validators, unless they are registered as custom ones', () => {
    const changed = setIn(doc, ['Address', 'validators'], ['loginAvailable']) as MetadataDoc;
    expect(errors(changed).map((i) => i.message)).toContainEqual(expect.stringContaining("Unknown validator 'loginAvailable'"));
    expect(errors(changed, ['loginAvailable'])).toEqual([]);
  });

  it("reports expressions that don't parse", () => {
    const changed = setIn(doc, ['StaffingResource', 'validators', 0, 'context', 'expression'], 'model.x = 1') as MetadataDoc;
    expect(errors(changed)).toContainEqual(
      expect.objectContaining({ path: ['StaffingResource', 'validators', 0, 'context', 'expression'], origin: 'library' }),
    );
  });

  it('reports duplicate error keys, as the library does', () => {
    const changed = setIn(doc, ['StaffingResource', 'validators', 1, 'id'], 'ADDRESS_REQUIRED') as MetadataDoc;
    const messages = errors(changed).map((i) => i.message);
    expect(messages).toContainEqual(expect.stringContaining("'expression_ADDRESS_REQUIRED'"));
  });

  it("reports a 'from' that neither the metadata nor the sources know", () => {
    const view = { ...doc, ResourceName: { properties: { firstName: { from: 'StaffingResource' }, nickname: { from: 'Nobody' } } } };
    const issues = checkDocument(view, { customValidators: [], catalog });
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.path)).toEqual([['ResourceName', 'properties', 'nickname', 'from']]);
  });

  it('warns about properties the model sources do not have', () => {
    const changed = setIn(doc, ['Address', 'properties', 'zip'], { required: true }) as MetadataDoc;
    const warnings = checkDocument(changed, { customValidators: [], catalog }).filter((i) => i.severity === 'warning');
    expect(warnings.map((i) => i.path)).toContainEqual(['Address', 'properties', 'zip']);
  });
});

describe('tester', () => {
  it('validates a sample with the real service', () => {
    const result = runTest([doc], 'Address', '{ "zipcode": "ABC", "city": "x" }', '', [], catalog);
    expect(result.failure).toBeUndefined();
    expect(result.errors!.map((e) => e.key)).toContain('zipCode_zipcode');
  });

  it('runs store() expressions against the given store', () => {
    const sample = '{ "id": 1 }';
    const withoutAddress = runTest([doc], 'StaffingResource', sample, '{}', [], catalog);
    const withAddress = runTest([doc], 'StaffingResource', sample, '{ "Address": [{ "staffingResourceId": 1 }] }', [], catalog);
    expect(withoutAddress.errors!.map((e) => e.id)).toContain('ADDRESS_REQUIRED');
    expect(withAddress.errors!.map((e) => e.id)).not.toContain('ADDRESS_REQUIRED');
  });
});

describe('doc helpers', () => {
  it('finds the line of a path in the formatted JSON', () => {
    const text = stringify({ A: { validators: ['x', { name: 'y' }] } });
    expect(text.split('\n')[lineOfPath(text, ['A', 'validators', 1])! - 1].trim()).toBe('{');
  });
});

describe('expression completion', () => {
  const env = { doc, catalog, functions: [{ name: 'isWeekend', params: ['d: Date'], returns: 'boolean', sourceFile: 'scope.ts' }] };
  const names = (text: string, site: Parameters<typeof complete>[2], pos = text.length) =>
    complete(text, pos, site, env)?.options.map((o) => o.name) ?? [];
  const property = { kind: 'validatorCondition' as const, modelType: 'StaffingResource', propertyName: 'hireDate' };

  it('offers the variables of each kind of expression', () => {
    expect(names('', property)).toEqual(expect.arrayContaining(['model', 'value', 'context', 'isClient', 'store', 'isWeekend', 'Math']));
    const model = names('', { kind: 'modelCondition', modelType: 'StaffingResource' });
    expect(model).toEqual(expect.arrayContaining(['entityInfos', 'findEntity']));
    expect(model).not.toContain('value');
  });

  it("offers the model's properties, and members of their types", () => {
    expect(names('model.', property)).toEqual(expect.arrayContaining(['firstName', 'hireDate', 'addresses']));
    expect(names('model.firstName.', property)).toEqual(expect.arrayContaining(['length', 'trim', 'startsWith']));
    expect(names('value.', property)).toContain('getFullYear');
    expect(names('model.addresses.', property)).toEqual(expect.arrayContaining(['some', 'filter', 'length']));
  });

  it("knows store('Type') and callback parameters", () => {
    expect(names("store('Add", property)).toContain('Address');
    expect(names("store('Address').some(a => a.", property)).toEqual(expect.arrayContaining(['staffingResourceId', 'city']));
    expect(names('model.addresses.filter(x => x.city.', property)).toContain('toUpperCase');
  });

  it('offers what the context always has, plus the rule settings', () => {
    const context = names('context.', { ...property, contextKeys: ['minValue'] });
    expect(context).toEqual(expect.arrayContaining(['model', 'modelType', 'propertyName', 'displayName', 'isServer', 'minValue']));
    expect(names('context.', { kind: 'validatorCondition', modelType: 'StaffingResource' })).toContain('propertyNames');
  });

  it('offers the globals, and nothing where an operator comes next', () => {
    expect(names('Math.', property)).toEqual(expect.arrayContaining(['max', 'round', 'PI']));
    expect(names('Date.', property)).toEqual(['now', 'parse', 'UTC']);
    expect(names('new Date().', property)).toContain('getTime');
    expect(complete('model ', 6, property, env)).toBeNull();
    expect(complete("'abc", 4, property, env)).toBeNull();
  });

  it('reads TypeScript and C# property types', () => {
    expect(typeFromText('string | null', catalog)).toEqual({ k: 'string' });
    expect(typeFromText('DateTime?', catalog)).toEqual({ k: 'date' });
    expect(typeFromText('List<Address>', catalog)).toEqual({ k: 'array', of: { k: 'model', name: 'Address' } });
    expect(typeFromText('Int32', catalog)).toEqual({ k: 'number' });
  });
});

describe("the app's validators and functions", () => {
  it('reads C# validators, the settings they read, and expression functions', () => {
    const { validators, functions } = parseCSharpApp(`
      /// <summary>A multiple of factor.</summary>
      public sealed class MultipleOfValidator : Validator
      {
          public MultipleOfValidator(string? group, ValidationContextBase? context)
              : base("multipleOf", group, WithMessage(context, "%displayName% must be a multiple of %factor%")) { }
          protected override bool ValidateCore(object? value, ValidatorFunctionContext context) =>
              value is null || Convert.ToDecimal(value) % context.GetValue<decimal>("factor") == 0
                  && !context.GetValue<bool>("strict") && context.GetValues<string>("excluded").Any() && context.GetValue<string>("displayName") != null;
      }
      public class LoginAvailable : AsyncValidator { public LoginAvailable(string? g, ValidationContextBase? c) : base("loginAvailable", g, c) { } }
      services.AddIdeaBladeValidation(v => v
          .AddValidators(new ValidatorFactory("multipleOf", (g, c) => new MultipleOfValidator(g, c)))
          .AddExpressionFunction("isWeekend", (Func<DateTime, bool>)(d => d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)));
    `);
    const multipleOf = validators.find((v) => v.name === 'multipleOf')!;
    expect(multipleOf).toMatchObject({ sync: true, async: false, defaultMessage: '%displayName% must be a multiple of %factor%', description: 'A multiple of factor.' });
    expect(multipleOf.settings).toEqual(['factor', 'strict', 'excluded']);
    expect(multipleOf.settingKinds).toEqual({ factor: 'number', strict: 'boolean', excluded: 'values' });
    expect(validators.find((v) => v.name === 'loginAvailable')).toMatchObject({ async: true, sync: false });
    expect(functions).toEqual([{ name: 'isWeekend', params: ['d: DateTime'], returns: 'bool', description: 'AddExpressionFunction' }]);
    // A validator class is not a model.
    expect(parseCSharp('public sealed class EvenValidator : Validator { public int Factor { get; set; } }', options)).toEqual([]);
  });

  it('counts them as known, and checks async against how they are registered', () => {
    const app = [{ name: 'loginAvailable', async: true, sync: false, settings: [], sourceFile: 'Login.cs' }];
    const changed = setIn(doc, ['Address', 'properties', 'city', 'validators'], ['loginAvailable']) as MetadataDoc;
    const issues = checkDocument(changed, { customValidators: ['loginAvailable'], catalog, appValidators: app }).filter((i) => i.severity === 'error');
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('registered as an asynchronous validator')]);
  });

  it('checks regular expression flags', () => {
    expect(checkRegexFlags('im')).toEqual([]);
    expect(checkRegexFlags('ix').map((p) => p.severity)).toEqual(['error']);
    expect(checkRegexFlags('gi').map((p) => p.severity)).toEqual(['info']);
    expect(checkRegexFlags('yi').map((p) => p.severity)).toEqual(['warning']);
    const changed = setIn(doc, ['Address', 'properties', 'city', 'validators'], [{ name: 'pattern', context: { expression: '/^[a-z]+$/q' } }]) as MetadataDoc;
    expect(errors(changed)[0]).toMatchObject({ path: ['Address', 'properties', 'city', 'validators', 0, 'context', 'expression'] });
  });
});

describe('several metadata documents', () => {
  // TempHire's client metadata: ResourceName's names follow StaffingResource's, which the server metadata and Breeze know.
  const client: MetadataDoc = { ResourceName: { properties: { firstName: { from: 'StaffingResource' }, nickname: { from: 'StaffingResource' } } } };

  it("resolves 'from' and properties across documents", () => {
    const view = mergeDocs([doc, client]);
    expect(Object.keys(view)).toEqual(expect.arrayContaining(['StaffingResource', 'ResourceName']));
    // nickname is in neither the metadata nor Breeze: an error, found with the server metadata open as well.
    const issues = checkDocument(client, { customValidators: [], catalog, workspace: [doc, client] }).filter((i) => i.severity === 'error');
    expect(issues.map((i) => i.path)).toEqual([['ResourceName', 'properties', 'nickname', 'from']]);
  });

  it('merges like the library: rules are added together', () => {
    const extra: MetadataDoc = { Address: { properties: { city: { validators: ['email'] } } } };
    const merged = mergeDocs([doc, extra]) as { Address: { properties: { city: { validators: unknown[] } } } };
    expect(merged.Address.properties.city.validators).toContain('email');
    // A rule in another document that repeats a key: the library's duplicate key check sees both.
    const clash: MetadataDoc = { StaffingResource: { validators: [{ name: 'expression', id: 'ADDRESS_REQUIRED', context: { expression: 'true' } }] } };
    const issues = checkDocument(clash, { customValidators: [], catalog, workspace: [doc, clash] }).filter((i) => i.severity === 'error');
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("'expression_ADDRESS_REQUIRED'")]);
  });

  it('tests a model with the rules of every document', () => {
    const result = runTest([doc, { Address: { properties: { city: { required: true } } } }], 'Address', '{ "city": "" }', '', [], catalog);
    expect(result.errors!.map((e) => e.key)).toContain('required_city');
  });
});

describe('metadata in C#', () => {
  const file = [
    'namespace TempHire.Server.Validation;',
    '',
    'public static class ClientValidationMetadata',
    '{',
    '    // Served to the client with the server metadata.',
    '    public const string Json = """',
    '        {',
    '          // the name editor',
    '          "ResourceName": { "properties": { "firstName": { "from": "StaffingResource" }, } }',
    '        }',
    '        """;',
    '',
    '    public const string NotMetadata = """',
    '        { "hello": 1 }',
    '        """;',
    '    public static string Other = "{ \\"x\\": {} }";',
    '}',
    '',
  ].join('\r\n');

  it('finds the metadata strings, with comments and trailing commas as .NET allows', () => {
    expect(readCsMetadata(file)).toEqual([
      { name: 'Json', json: { ResourceName: { properties: { firstName: { from: 'StaffingResource' } } } }, hasComments: true },
    ]);
  });

  it('rewrites only the string, keeping the indentation and line endings', () => {
    const json = { ResourceName: { properties: { firstName: { from: 'StaffingResource' }, lastName: { from: 'StaffingResource' } } } };
    const written = writeCsMetadata(file, 'Json', json);
    expect(written.startsWith(file.slice(0, file.indexOf('"""')))).toBe(true);
    expect(written.endsWith(file.slice(file.indexOf('\r\n\r\n    public const string NotMetadata')))).toBe(true);
    expect(written).toContain('Json = """\r\n        {\r\n          "ResourceName": {');
    expect(written).toContain('        }\r\n        """;');
    expect(written).not.toContain('\n\n        {');
    expect(readCsMetadata(written)).toEqual([{ name: 'Json', json, hasComments: false }]);
  });

  it('adds another map next to the last one, in the same class, typed when the file is', () => {
    const typed = newCsMetadataFile('ClientMetadata', { A: {} });
    const added = insertCsMetadata(typed, 'AdminJson', { B: { properties: {} } });
    expect(readCsMetadata(added).map((m) => m.name)).toEqual(['Json', 'AdminJson']);
    expect(readCsMetadata(added)[1].json).toEqual({ B: { properties: {} } });
    // after the first map's typed member, inside the class, with its own typed member
    const lines = added.split('\n');
    expect(lines.findIndex((l) => l.includes('public const string AdminJson'))).toBeGreaterThan(lines.findIndex((l) => l.includes('Metadata = ModelValidationMetadataMap.Parse(Json)')));
    expect(added).toContain('    public static readonly ModelValidationMetadataMap AdminMetadata = ModelValidationMetadataMap.Parse(AdminJson);');
    expect(added.trimEnd().endsWith('}')).toBe(true);
    // a plain file (no typed members) gets just the string
    const plain = ['public static class M', '{', '    public const string Json = """', '        {"A": {}}', '        """;', '}', ''].join('\n');
    const plainAdded = insertCsMetadata(plain, 'Other', { C: {} });
    expect(plainAdded).not.toContain('ModelValidationMetadataMap');
    expect(readCsMetadata(plainAdded).map((m) => m.name)).toEqual(['Json', 'Other']);
    expect(() => insertCsMetadata(plain, 'Json', {})).toThrow(/already uses the name 'Json'/);
  });

  it('writes a new file, and reads verbatim strings', () => {
    expect(pascalCaseFromFile('C:/x/client-validation.metadata.cs')).toBe('ClientValidationMetadata');
    const created = newCsMetadataFile('ClientValidationMetadata', { A: {} });
    // one map (the JSON constant), typed as the library's ModelValidationMetadataMap next to it, with its using
    expect(readCsMetadata(created)).toEqual([{ name: 'Json', json: { A: {} }, hasComments: false }]);
    expect(created.startsWith('using IdeaBlade.Validation.Metadata;\n')).toBe(true);
    expect(created).toContain('public static readonly ModelValidationMetadataMap Metadata = ModelValidationMetadataMap.Parse(Json);');
    expect(readCsMetadata(writeCsMetadata(created, 'Json', { B: {} }))[0].json).toEqual({ B: {} });
    const verbatim = 'var json = @"{ ""A"": { ""properties"": {} } }";';
    expect(readCsMetadata(verbatim)[0]).toMatchObject({ name: 'json', json: { A: { properties: {} } } });
    expect(readCsMetadata(writeCsMetadata(verbatim, 'json', { B: {} }))[0].json).toEqual({ B: {} });
  });
});

describe('the regular expression panel', () => {
  it('explains a pattern step by step, and each piece', () => {
    const a = analyzeRegex('^\\d{5}(?:-\\d{4})?$');
    expect(a.error).toBeUndefined();
    expect(a.steps.map((s) => s.explanation)).toEqual([
      'the start of the value',
      'a digit (0–9), exactly 5 times',
      "('-', then a digit (0–9), exactly 4 times), optionally",
      'the end of the value',
    ]);
    const quantifier = a.tokens.find((t) => t.raw === '{5}' || t.raw === '\\d{5}');
    expect(quantifier?.explanation).toBe('Repeats what comes before it exactly 5 times.');
    expect(a.tokens.find((t) => t.raw === '[A-Z]')).toBeUndefined();
    expect(analyzeRegex('[^A-Z0-9]').tokens[0].explanation).toBe('Any character except A–Z, 0–9.');
    expect(analyzeRegex('(?<code>[A-Z]+)').tokens[0].explanation).toBe("Group 'code': one of: A–Z, one or more times.");
  });

  it('reads /source/flags, and reports where a pattern breaks', () => {
    expect(splitPattern('/^a$/i', 'm')).toEqual({ source: '^a$', flags: 'i', literal: true });
    expect(splitPattern('^a$', 'm')).toEqual({ source: '^a$', flags: 'm', literal: false });
    const broken = analyzeRegex('^[A-Z');
    expect(broken.error).toMatchObject({ index: 5 });
    expect(broken.error!.message).toMatch(/Unterminated character class/);
  });

  it('warns about partial matches, and offers anchors', () => {
    const [hint] = analyzeRegex('\\d{5}').hints;
    expect(hint).toMatchObject({ severity: 'warning', fix: { pattern: '^\\d{5}$' } });
    expect(hint.message).toContain("'x11111x'");
    expect(analyzeRegex('a|b').hints[0].fix!.pattern).toBe('^(?:a|b)$');
    expect(analyzeRegex('^a$').hints).toEqual([]);
    expect(analyzeRegex('^\\d+$', 's').hints.map((h) => h.message)).toEqual([expect.stringContaining('non-ASCII digits')]);
  });

  it('tests values as the validator does, with the matched parts', () => {
    const results = testSamples('\\d{5}', '', ['12345', 'abc12345xyz', 'abc', ''])!;
    expect(results.map((r) => r.passes)).toEqual([true, true, false, true]);
    expect(results[1].matches).toEqual([{ start: 3, end: 8 }]);
    // 'g' changes nothing, as the validator starts each test from the start.
    expect(testSamples('^a', 'g', ['a', 'a', 'a'])!.map((r) => r.passes)).toEqual([true, true, true]);
    expect(testSamples('[', '', ['x'])).toBeUndefined();
  });

  it('points out where the .NET server, which ignores u, differs or fails', () => {
    const messages = (pattern: string, flags = '') => analyzeRegex(pattern, flags).hints.map((h) => h.message);
    // \p{…} without u: the text 'p{L}' in the browser, a category on the server.
    expect(messages(String.raw`^\p{L}+$`)).toEqual([expect.stringContaining('needs the u flag')]);
    expect(messages(String.raw`^\p{L}+$`, 'u')).toEqual([]);
    // Syntax the server can't parse.
    expect(messages(String.raw`^\u{1F600}$`, 'u')).toEqual([expect.stringContaining("can't parse")]);
    expect(messages(String.raw`^\p{Script=Greek}+$`, 'u')).toEqual([expect.stringContaining("can't parse")]);
    // \p{…} puts the server in its standard mode, where \d is Unicode-aware.
    expect(messages(String.raw`^\p{L}\d$`, 'u')).toEqual([expect.stringContaining('Because of \\p{…}')]);
    // An emoji is one character in the browser with u, two on the server.
    expect(messages('^😀$', 'u')).toEqual([expect.stringContaining('beyond U+FFFF')]);
    expect(messages('^😀$')).toEqual([]);
  });

  it('reports patterns the server cannot parse as errors, and \\p without u as a warning', () => {
    const rule = (expression: string, flags?: string) =>
      checkDocument(setIn(doc, ['Address', 'properties', 'city', 'validators'], [{ name: 'pattern', context: { expression, ...(flags ? { flags } : {}) } }]) as MetadataDoc, {
        customValidators: [],
        catalog,
      }).filter((i) => i.path[1] === 'properties' && i.path[2] === 'city');
    expect(rule(String.raw`^\p{Script=Greek}+$`, 'u').map((i) => i.severity)).toEqual(['error']);
    expect(rule(String.raw`^\p{L}+$`).map((i) => i.severity)).toEqual(['warning']);
    expect(rule(String.raw`^\p{L}+$`, 'u')).toEqual([]);
    expect(serverUnsupported(String.raw`\u{1F600}\p{sc=Grek}`)).toEqual(['\\u{…}', '\\p{…=…}']);
  });

  it('keys test values like the rule error key, so an id on a property rule changes nothing', () => {
    expect(regexTestKey('Address', 'city', undefined, undefined)).toBe('Address.city');
    expect(regexTestKey('Address', 'city', undefined, 'CITY')).toBe('Address.city');
    expect(regexTestKey('Address', 'city', 'submit', undefined)).toBe('Address.city@submit');
    expect(regexTestKey('Order', undefined, undefined, 'DATES')).toBe('Order#DATES');
    expect(regexTestKey('Order', undefined, 'submit', 'DATES')).toBe('Order@submit#DATES');
    expect(regexTestKey(undefined, undefined, undefined, undefined)).toBe('global#');
  });

  it('offers common patterns that compile and match what they say', () => {
    for (const p of COMMON_PATTERNS) expect(analyzeRegex(p.pattern).error, p.label).toBeUndefined();
    const zip = COMMON_PATTERNS.find((p) => p.builtIn === 'zipCode')!;
    expect(testSamples(zip.pattern, '', ['98101', '98101-1234', '9810'])!.map((r) => r.passes)).toEqual([true, true, false]);
  });
});
