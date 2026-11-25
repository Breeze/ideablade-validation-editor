import type { RuleEntry } from '../../../lib/doc';

/**
 * A new rule for the validator `name`, as the rule list's "Add rule" adds it. Validators that need settings to be of
 * any use start with them (empty or a typical value), so the rule editor shows those fields and the checks point at
 * what's missing; the rest start as a bare name.
 */
export function newRule(name: string): RuleEntry {
  switch (name) {
    case 'expression':
      return { name, context: { expression: '', messageTemplate: '' } };
    case 'pattern':
      return { name, context: { expression: '' } };
    case 'minLength':
    case 'maxLength':
      return { name, context: { [name]: 1 } };
    case 'range':
    case 'numericRange':
    case 'dateRange':
      return { name, context: { minValue: 0 } };
    case 'compare':
      return { name, context: { other: '', op: '==' } };
    case 'validValues':
    case 'invalidValues':
      return { name, context: { values: [] } };
    default:
      return name;
  }
}
