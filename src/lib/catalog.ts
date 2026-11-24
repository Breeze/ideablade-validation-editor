// The built-in validators and their context settings, from the library's docs/validators.md.

export type SettingKind = 'boolean' | 'integer' | 'text' | 'bound' | 'expression' | 'property' | 'op' | 'values' | 'regex';

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
  /** Validators that only make sense at model level, or that take the property value. Informational. */
  modelLevel?: boolean;
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
      { key: 'flags', kind: 'text' },
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
