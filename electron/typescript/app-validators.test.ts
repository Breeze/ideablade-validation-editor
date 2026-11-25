// Tests for app-validators.ts (node --test, compiled to dist-electron/typescript/app-validators.test.js; see
// scripts/test-main.mjs): the application's validators as read from TypeScript, here what kind of value each works with.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTypeScriptApp } from './app-validators';

const valueTypes = (text: string): Record<string, string | undefined> =>
  Object.fromEntries(parseTypeScriptApp(text).validators.map((v) => [v.name, v.valueType]));

describe("the application's validators", () => {
  it('know the type of value they work with, from the parameter type or what the code does with the value', () => {
    const types = valueTypes(`
      import { SyncValidator, asyncValidator, syncValidator, withMessage } from 'ideablade-validation';
      export class MultipleOfValidator extends SyncValidator {
        constructor(group?: string, context?: Record<string, unknown>) {
          super('multipleOf', group, (v, ctx) => v == null || v % ctx.factor === 0, withMessage(context, 'x'));
        }
      }
      export const multipleOf = { name: 'multipleOf', fn: (g: string, c: Record<string, unknown>) => new MultipleOfValidator(g, c) };
      export const weekday = syncValidator('weekday', (d) => d == null || d.getDay() > 0);
      export const short = syncValidator('short', (s) => s == null || s.trim().length < 5);
      export const whole = syncValidator('whole', (n) => Number.isInteger(n));
      export const login = asyncValidator('loginAvailable', (login: string) => Promise.resolve(true));
    `);
    assert.deepEqual(types, { multipleOf: 'number', weekday: 'Date', short: 'string', whole: 'number', loginAvailable: 'string' });
  });

  it("take any value when the code makes text of it, shows more than one kind, or doesn't say", () => {
    const types = valueTypes(`
      import { syncValidator } from 'ideablade-validation';
      export const words = syncValidator('maxWords', (v, { maxWords }) => v == null || String(v).split(' ').length <= maxWords);
      export const label = syncValidator('label', (v) => \`\${v}\`.length < 10);
      export const mixed = syncValidator('mixed', (v) => v.trim() !== '' && v.getDay() > 0);
      export const any = syncValidator('present', (v) => v != null);
    `);
    assert.deepEqual(types, { maxWords: undefined, label: undefined, mixed: undefined, present: undefined });
  });
});
