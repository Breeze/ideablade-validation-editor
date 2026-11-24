import { describe, expect, it } from 'vitest';

import breezeMetadata from '../../samples/temphire.breeze-metadata.json';
import tempHireMetadata from '../../samples/temphire.validation.metadata.json';
import { checkDocument } from './check';
import { type MetadataDoc, lineOfPath, setIn, stringify } from './doc';
import { buildCatalog, camelCase, parseBreeze, parseCSharp, parseSource } from './sources';
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
    const result = runTest(doc, 'Address', '{ "zipcode": "ABC", "city": "x" }', '', [], catalog);
    expect(result.failure).toBeUndefined();
    expect(result.errors!.map((e) => e.key)).toContain('zipCode_zipcode');
  });

  it('runs store() expressions against the given store', () => {
    const sample = '{ "id": 1 }';
    const withoutAddress = runTest(doc, 'StaffingResource', sample, '{}', [], catalog);
    const withAddress = runTest(doc, 'StaffingResource', sample, '{ "Address": [{ "staffingResourceId": 1 }] }', [], catalog);
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
