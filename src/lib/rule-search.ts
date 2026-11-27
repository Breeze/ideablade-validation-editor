import { isGroup, isPlainObject } from './doc';

/**
 * Searching a model's properties and rules (the model editor's "Find properties and rules…" and "Find model-level
 * rules…"). What's typed is split into words at spaces; something matches when every word appears somewhere in its
 * text, in any order and ignoring case, so `gt prene` finds the rule whose id is GT_REQUIRES_PRENEED and `range
 * 999` the properties with that range.
 */

/** The words of a search, lower-cased; none when it's empty. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether every word is in the text (already lower-cased, as the *Text functions below return it). */
export function matchesWords(text: string, words: readonly string[]): boolean {
  return words.every((w) => text.includes(w));
}

/**
 * The text a rule is searched in: its values, not its keys (every rule has `name` and `context`, so those would match
 * everything), which covers the validator's name, `id`, `condition`, `propertyNames`, the context's settings
 * (messages, expressions, patterns, numbers) and `$comment`. A group's text is its name and `$comment` only: its
 * rules are searched one by one.
 */
export function ruleText(rule: unknown): string {
  if (!isPlainObject(rule) || !isGroup(rule)) return collect(rule);
  return collect([rule.group, rule.$comment]);
}

/**
 * The text a property is searched in: its name, the shorthands it sets (`required`, `minLength 2`, `maxLength 50`,
 * by name, as they show on its card), `displayName`, `from`, `$comment` and all its rules, groups' names included.
 */
export function propertyText(name: string, entry: unknown): string {
  const parts: unknown[] = [name];
  if (isPlainObject(entry)) {
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'required' && value) parts.push('required');
      else if (key === 'minLength' || key === 'maxLength') parts.push(`${key} ${value}`);
      else parts.push(value);
    }
  }
  return collect(parts);
}

/** Every string, number and boolean in a JSON value, lower-cased, one per line. */
function collect(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isPlainObject(v)) Object.values(v).forEach(walk);
    else if (v !== null && v !== undefined) out.push(String(v).toLowerCase());
  };
  walk(value);
  return out.join('\n');
}
