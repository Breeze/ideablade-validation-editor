// Tests for typescript-metadata.cjs (node --test): they need the real TypeScript compiler, which the Angular test
// build doesn't bundle.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { readTsMetadata, writeTsMetadata, newTsMetadataFile } = require('./typescript-metadata.cjs');

// As TempHire's client-validation-metadata.ts, with Windows line endings.
const file = [
  "import { ModelValidationMetadataMap } from 'ideablade-validation';",
  '',
  '/** The client\'s own view models. */',
  'export const clientValidationMetadata: ModelValidationMetadataMap = {',
  '  ResourceName: {',
  '    properties: {',
  "      firstName: { from: 'StaffingResource' },",
  "      lastName: { from: 'StaffingResource' },",
  '    },',
  '  },',
  '};',
  '',
  'export const other = { a: 1 };',
  '',
].join('\r\n');

describe('metadata in TypeScript', () => {
  it('reads the metadata maps as JSON', () => {
    assert.deepEqual(readTsMetadata(file, 'client.ts'), [
      {
        name: 'clientValidationMetadata',
        json: { ResourceName: { properties: { firstName: { from: 'StaffingResource' }, lastName: { from: 'StaffingResource' } } } },
        hasComments: false,
      },
    ]);
  });

  it('writes an unchanged map back byte for byte', () => {
    const [map] = readTsMetadata(file, 'client.ts');
    assert.equal(writeTsMetadata(file, 'client.ts', map.name, map.json), file);
  });

  it('rewrites only the object, in the Prettier style the file uses', () => {
    const json = {
      ResourceName: { properties: { firstName: { from: 'StaffingResource' } } },
      'Odd-Name': { validators: [{ name: 'expression', id: 'X', context: { expression: "model.a === 'it''s'", messageTemplate: 'A must be set' } }] },
    };
    const written = writeTsMetadata(file, 'client.ts', 'clientValidationMetadata', json);
    assert.ok(written.startsWith(file.slice(0, file.indexOf('= {') + 2)));
    assert.ok(written.endsWith('};\r\n\r\nexport const other = { a: 1 };\r\n'));
    assert.match(written, /\r\n {2}'Odd-Name': \{\r\n/);
    assert.match(written, /expression: 'model\.a === \\'it\\'\\'s\\''/);
    assert.deepEqual(readTsMetadata(written, 'client.ts')[0].json, json);
  });

  it('marks maps with code in them read-only, and notices comments', () => {
    const [spread] = readTsMetadata("const base = {}; export const m = { ...base } satisfies ModelValidationMetadataMap;", 'x.ts');
    assert.match(spread.readOnly, /A spread at line 1/);
    const [commented] = readTsMetadata('export const m: ModelValidationMetadataMap = {\n  // why\n  A: {},\n};', 'x.ts');
    assert.equal(commented.hasComments, true);
  });

  it('adds the import of ModelValidationMetadataMap when the file has none, so the type annotation compiles', () => {
    const json = { A: { properties: { b: { required: true } } } };
    const bare = 'export const m: ModelValidationMetadataMap = {};\n';
    assert.equal(writeTsMetadata(bare, 'x.ts', 'm', json).split('\n').slice(0, 3).join('\n'),
      "import type { ModelValidationMetadataMap } from 'ideablade-validation';\n\nexport const m: ModelValidationMetadataMap = {");
    const others = "import { syncValidator } from 'ideablade-validation';\nexport const m = {} satisfies ModelValidationMetadataMap;\n";
    const written = writeTsMetadata(others, 'x.ts', 'm', json);
    assert.ok(written.startsWith("import type { ModelValidationMetadataMap } from 'ideablade-validation';\nimport { syncValidator }"));
    assert.deepEqual(readTsMetadata(written, 'x.ts')[0].json, json);
    // imported already (as TempHire's file does): only the object changes
    assert.ok(writeTsMetadata(file, 'client.ts', 'clientValidationMetadata', json).startsWith(file.split('\r\n')[0]));
    assert.equal(writeTsMetadata(file, 'client.ts', 'clientValidationMetadata', json).split("from 'ideablade-validation'").length, 2);
  });

  it('writes a new file', () => {
    const text = newTsMetadataFile('clientValidationMetadata', { A: { properties: { b: { required: true } } } });
    assert.deepEqual(readTsMetadata(text, 'new.ts')[0].json, { A: { properties: { b: { required: true } } } });
    assert.match(text, /^import type \{ ModelValidationMetadataMap \} from 'ideablade-validation';/);
  });
});
