// "Try it": validates a sample object against the metadata being edited, with the library's real service.

import { createValidationService } from 'ideablade-validation';

import type { MetadataDoc } from './doc';
import { type Catalog, type CatalogModel } from './sources';
import { catalogRuleSource, stubValidators } from './check';

export interface TestError {
  key: string;
  id: string;
  message: string;
  propertyNames: readonly string[];
}

export interface TestResult {
  errors?: TestError[];
  failure?: string;
}

export function runTest(
  docs: readonly MetadataDoc[],
  modelType: string,
  sampleText: string,
  storeText: string,
  customValidators: readonly string[],
  catalog: Catalog,
): TestResult {
  let sample: unknown;
  let store: Record<string, unknown[]>;
  try {
    sample = JSON.parse(sampleText);
  } catch (e) {
    return { failure: `The sample isn't valid JSON: ${(e as Error).message}` };
  }
  try {
    store = storeText.trim() ? JSON.parse(storeText) : {};
  } catch (e) {
    return { failure: `The store isn't valid JSON: ${(e as Error).message}` };
  }
  try {
    const service = createValidationService({
      metadata: docs as never,
      validators: stubValidators(customValidators),
      ruleSources: [catalogRuleSource(catalog)],
      onDuplicateErrorKey: () => {},
    });
    const errors = service.validateModelSync(sample, modelType, {
      store: (type: string) => store[type] ?? [],
    });
    return {
      errors: errors.map((e) => ({ key: e.key, id: e.id, message: e.errorMessage, propertyNames: e.propertyNames })),
    };
  } catch (e) {
    return { failure: (e as Error).message };
  }
}

/** A starting sample: the properties the model sources and the metadata know, with empty values. */
export function sampleFor(modelType: string, doc: MetadataDoc, catalogModel: CatalogModel | undefined): string {
  const sample: Record<string, unknown> = {};
  for (const p of catalogModel?.properties ?? []) {
    if (p.navigation) continue;
    sample[p.name] = /^(Int|Decimal|Double|Single|Byte|number|int|long|decimal|double|float)/i.test(p.type) ? 0 : null;
  }
  const entry = doc[modelType] as { properties?: Record<string, unknown> } | undefined;
  for (const name of Object.keys(entry?.properties ?? {})) {
    if (!(name in sample)) sample[name] = null;
  }
  return JSON.stringify(sample, null, 2);
}
