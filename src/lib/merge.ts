// Moving a model type or a whole map onto another map (dragging in the sidebar) merges them where the target already
// has the same model type. The library merges several maps much the same way when it loads them (docs/metadata.md:
// validator lists concatenated, properties merged, scalar settings taking the last value); here, moving one into the
// other:
//
// - validator lists (model rules, property rules, the global rules) are concatenated, without exact duplicates, so a
//   rule that was in both doesn't run twice;
// - properties are merged the same way, property by property;
// - a scalar setting (`displayName`, `required`, `extends`, `condition`, `$comment`, ...) the target doesn't have is
//   taken over; one it has with another value stays as the target has it, and is reported as kept.

import { type Json, type JsonObject, isModelKey, isPlainObject } from './doc';

/** A JSON value as compared: objects with their keys sorted, so key order doesn't matter. */
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The target's rules, then the source's that aren't already there. */
function mergeValidators(into: Json | undefined, from: Json | undefined): Json[] {
  const result = Array.isArray(into) ? [...into] : [];
  const seen = new Set(result.map(canonical));
  for (const rule of Array.isArray(from) ? from : []) {
    if (!seen.has(canonical(rule))) {
      result.push(rule);
      seen.add(canonical(rule));
    }
  }
  return result;
}

/** Merges two entries with `validators` and scalar settings; `kept` gets the settings where the target's value stays. */
function mergeEntry(into: JsonObject, from: JsonObject, where: string, kept: string[], nested?: (key: string) => boolean): JsonObject {
  const result: JsonObject = { ...into };
  for (const [key, value] of Object.entries(from)) {
    if (key === 'validators') {
      result.validators = mergeValidators(into.validators, value);
    } else if (nested?.(key)) {
      continue; // merged by the caller
    } else if (!(key in into)) {
      result[key] = value;
    } else if (canonical(into[key]) !== canonical(value)) {
      kept.push(`${where}${key}`);
    }
  }
  return result;
}

/**
 * Model type `from` merged into model type `into` (both the same type, from two maps). `kept` lists the settings both
 * have with different values, where `into`'s stays: `displayName` of a property shows as `properties.firstName.displayName`.
 */
export function mergeModel(into: JsonObject, from: JsonObject): { model: JsonObject; kept: string[] } {
  const kept: string[] = [];
  const model = mergeEntry(into, from, '', kept, (key) => key === 'properties');
  const fromProperties = isPlainObject(from.properties) ? from.properties : undefined;
  if (fromProperties) {
    const properties: JsonObject = { ...(isPlainObject(into.properties) ? into.properties : {}) };
    for (const [name, property] of Object.entries(fromProperties)) {
      const existing = properties[name];
      properties[name] =
        isPlainObject(existing) && isPlainObject(property) ? mergeEntry(existing, property, `properties.${name}.`, kept) : (existing ?? property);
    }
    model.properties = properties;
  }
  return { model, kept };
}

/**
 * A whole map `from` merged into map `into`: its model types added or merged (see mergeModel), its global rules added
 * to the target's. The target's `$schema` and `$comment` stay. `kept` is by model type; `merged` lists the model types
 * both had.
 */
export function mergeMaps(into: JsonObject, from: JsonObject): { map: JsonObject; merged: string[]; kept: string[] } {
  const map: JsonObject = { ...into };
  const merged: string[] = [];
  const kept: string[] = [];
  for (const [key, value] of Object.entries(from)) {
    if (key === 'global') {
      if (isPlainObject(value)) {
        const target = isPlainObject(into.global) ? into.global : {};
        map.global = { ...target, validators: mergeValidators(target.validators, value.validators) };
      }
    } else if (!isModelKey(key)) {
      continue; // $schema, $comment: the target's
    } else if (isPlainObject(into[key]) && isPlainObject(value)) {
      const result = mergeModel(into[key] as JsonObject, value);
      map[key] = result.model;
      merged.push(key);
      kept.push(...result.kept.map((k) => `${key}.${k}`));
    } else {
      map[key] = value;
    }
  }
  return { map, merged, kept };
}
