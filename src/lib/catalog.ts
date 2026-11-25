// The validators the editor offers: the built-in ones and their context settings (from the library's
// docs/validators.md), the application's own (found in the TS / C# sources), and names listed in the settings.

import { type SourceValidator, type ValueKind, valueKind } from './sources';

export type SettingKind = 'boolean' | 'integer' | 'text' | 'bound' | 'expression' | 'property' | 'op' | 'values' | 'regex' | 'flags';

export interface SettingInfo {
  key: string;
  kind: SettingKind;
  label?: string;
  help?: string;
}

export interface ValidatorInfo {
  name: string;
  description: string;
  defaultMessage?: string;
  settings: SettingInfo[];
  /** Where it comes from: 'built-in', a source file name, or 'settings'. */
  origin?: string;
  /** For the application's validators: registered as async / sync. */
  async?: boolean;
  sync?: boolean;
  /**
   * The kinds of value it's meant for; undefined: any. The built-in ones' as their code in the library treats values
   * (minLength fails for anything but text, pattern tests the value as text); the application's as read from its code.
   */
  appliesTo?: readonly ValueKind[];
}

const rangeSettings: SettingInfo[] = [
  { key: 'minValue', kind: 'bound', help: 'number, date, or relative date such as now-18y, today+30d, year' },
  { key: 'maxValue', kind: 'bound', help: 'number, date, or relative date such as now-18y, today+30d, year' },
  { key: 'exclusive', kind: 'boolean' },
];

export const BUILT_IN_VALIDATORS: ValidatorInfo[] = [
  { name: 'required', description: 'A value is required.', defaultMessage: '%displayName% is required', settings: [{ key: 'trim', kind: 'boolean', help: 'whitespace-only fails' }] },
  { name: 'minLength', description: 'At least n characters.', defaultMessage: '%displayName% must be at least %minLength% characters', settings: [{ key: 'minLength', kind: 'integer' }] },
  { name: 'maxLength', description: 'At most n characters.', defaultMessage: '%displayName% must be at most %maxLength% characters', settings: [{ key: 'maxLength', kind: 'integer' }] },
  {
    name: 'pattern',
    description: 'Matches a regular expression.',
    defaultMessage: "%displayName% '%value%' does not match the required format",
    settings: [
      { key: 'expression', kind: 'regex', label: 'pattern', help: 'pattern source, or "/source/flags"' },
      { key: 'flags', kind: 'flags', help: 'regular expression flags' },
    ],
  },
  { name: 'email', description: 'An email address.', settings: [] },
  { name: 'zipCode', description: 'US ZIP or ZIP+4.', settings: [] },
  { name: 'phone', description: '10-digit US phone; punctuation allowed.', settings: [] },
  { name: 'social', description: 'US SSN, 123-45-6789 or 123456789.', settings: [] },
  { name: 'fein', description: 'US FEIN, 12-3456789.', settings: [] },
  { name: 'currency', description: 'Numbers, or strings like 1,234.56, -12, $5.00.', settings: [] },
  {
    name: 'numeric',
    description: 'A whole or decimal number.',
    settings: [
      { key: 'allowDecimals', kind: 'boolean' },
      { key: 'allowLeadingZeros', kind: 'boolean' },
      { key: 'allowNegative', kind: 'boolean' },
    ],
  },
  { name: 'integer', description: 'An integer (negatives allowed).', settings: [] },
  { name: 'range', description: 'Between minValue and maxValue (numbers or dates).', defaultMessage: '%displayName% must be between %minValueText% and %maxValueText%', settings: rangeSettings },
  { name: 'numericRange', description: 'Alias of range.', settings: rangeSettings },
  { name: 'dateRange', description: 'Alias of range.', settings: rangeSettings },
  { name: 'date', description: 'A valid date.', settings: [{ key: 'allowString', kind: 'boolean' }] },
  {
    name: 'compare',
    description: 'Compares with another property.',
    settings: [
      { key: 'other', kind: 'property', help: 'property name' },
      { key: 'op', kind: 'op' },
    ],
  },
  { name: 'invalidValues', description: 'Not one of the values ("/^Z/i" entries are patterns).', settings: [{ key: 'values', kind: 'values' }] },
  { name: 'validValues', description: 'One of the values.', settings: [{ key: 'values', kind: 'values' }] },
  {
    name: 'expression',
    description: 'An expression must be truthy.',
    defaultMessage: '%displayName% is invalid',
    settings: [
      { key: 'expression', kind: 'expression' },
      { key: 'skipEmpty', kind: 'boolean' },
    ],
  },
  { name: 'unique', description: 'Unique within the entity store (needs store()).', settings: [{ key: 'ignoreCase', kind: 'boolean' }] },
  { name: 'breeze', description: "Breeze's own validators (ideablade-validation/breeze). Usually global.", settings: [] },
];

/**
 * The kinds of value the built-in validators are meant for, from the library's code (js/src/validators): the length
 * validators fail for anything but text; the pattern ones test the value as text (so a number works, true/false and
 * dates don't mean anything); currency, numeric and integer take a number or text holding one; range compares
 * numbers, dates, or text holding a number; date takes a date, or text with allowString. The rest take any value.
 */
const APPLIES_TO: Record<string, readonly ValueKind[]> = {
  minLength: ['text'],
  maxLength: ['text'],
  pattern: ['text', 'number'],
  email: ['text'],
  zipCode: ['text', 'number'],
  phone: ['text', 'number'],
  social: ['text', 'number'],
  fein: ['text'],
  currency: ['number', 'text'],
  numeric: ['number', 'text'],
  integer: ['number', 'text'],
  range: ['number', 'date', 'text'],
  numericRange: ['number', 'text'],
  dateRange: ['date', 'text'],
  date: ['date', 'text'],
};
for (const v of BUILT_IN_VALIDATORS) if (APPLIES_TO[v.name]) v.appliesTo = APPLIES_TO[v.name];

/** "text", "numbers or text": the kinds a validator is for, in a sentence. */
export function kindsText(kinds: readonly ValueKind[]): string {
  const words: Record<ValueKind, string> = { text: 'text', number: 'numbers', 'true/false': 'true/false values', date: 'dates' };
  const list = kinds.map((k) => words[k]);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
}

/** Whether a validator is meant for a property holding this kind of value (unknown kinds and "any" validators fit). */
export function appliesTo(info: ValidatorInfo | undefined, kind: ValueKind | undefined): boolean {
  return !info?.appliesTo || !kind || info.appliesTo.includes(kind);
}

/**
 * The validators as choices for a property's rules: each one meant for some kinds only says which ("for text"), and
 * one that isn't meant for the property's kind is marked, so it stands out before it's picked. `kind` undefined (a
 * model-level rule, or a property no source declares): just what each is for.
 */
export function validatorChoices(validators: readonly ValidatorInfo[], kind: ValueKind | undefined): { value: string; detail?: string; warn?: boolean }[] {
  return validators.map((v) => {
    const fits = appliesTo(v, kind);
    return {
      value: v.name,
      detail: !v.appliesTo ? undefined : fits ? `for ${kindsText(v.appliesTo)}` : `⚠ not for ${kindsText([kind!])}`,
      warn: !fits || undefined,
    };
  });
}

export const BUILT_IN_NAMES = BUILT_IN_VALIDATORS.map((v) => v.name);

export const OPERATORS = ['==', '===', '!=', '!==', '<', '<=', '>', '>='];

/** Context keys every validator accepts. */
export const COMMON_SETTINGS: SettingInfo[] = [
  { key: 'messageTemplate', kind: 'text', help: '%displayName%, %value%, %propertyName% and the context settings' },
  { key: 'displayName', kind: 'text' },
];

export function validatorInfo(name: string): ValidatorInfo | undefined {
  return BUILT_IN_VALIDATORS.find((v) => v.name === name);
}

const SETTING_KINDS: Record<string, SettingKind> = { integer: 'integer', number: 'bound', boolean: 'boolean', values: 'values', text: 'text', bound: 'bound' };

/** Every validator the editor knows: built-in, the application's (from the sources), and those named in the settings. */
export function validatorCatalog(app: readonly (SourceValidator & { sourceFile?: string })[], customNames: readonly string[]): ValidatorInfo[] {
  const list: ValidatorInfo[] = BUILT_IN_VALIDATORS.map((v) => ({ ...v, origin: 'built-in' }));
  for (const v of app) {
    if (list.some((x) => x.name === v.name)) continue;
    list.push({
      name: v.name,
      description: [v.description, `From ${v.sourceFile ?? 'a source file'}${v.async && !v.sync ? ' (async)' : ''}.`].filter(Boolean).join(' '),
      defaultMessage: v.defaultMessage,
      settings: v.settings.map((key) => ({ key, kind: SETTING_KINDS[v.settingKinds?.[key] ?? 'bound'] ?? 'bound', help: 'read by the validator' })),
      origin: v.sourceFile,
      async: v.async,
      sync: v.sync,
      appliesTo: valueKind(v.valueType) ? [valueKind(v.valueType)!] : undefined,
    });
  }
  for (const name of customNames) {
    if (!list.some((x) => x.name === name)) list.push({ name, description: 'Listed under Settings → Custom validators.', settings: [], origin: 'settings' });
  }
  return list;
}
