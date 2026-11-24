// A sample source with an application's own validators and expression functions, as the editor reads them
// (Add source…): their names, default messages and the context settings their code reads show up in the rule forms,
// and the functions in expression completion. Not part of the editor; it isn't compiled.
import { SyncValidator, asyncValidator, createValidationService, syncValidator, withMessage } from 'ideablade-validation';

/** The value must be a multiple of `factor`. */
export class MultipleOfValidator extends SyncValidator {
  constructor(group?: string, context?: Record<string, unknown>) {
    super('multipleOf', group, (v, ctx) => v == null || v % ctx.factor === 0, withMessage(context, '%displayName% must be a multiple of %factor%'));
  }
}
export const multipleOf = { name: 'multipleOf', fn: (g: string, c: Record<string, unknown>) => new MultipleOfValidator(g, c) };

/** At most `maxWords` words. */
export const maxWords = syncValidator(
  'maxWords',
  (v, { maxWords, separator = ' ' }) => v == null || String(v).split(separator).length <= maxWords,
  '%displayName% has more than %maxWords% words',
);

export const loginAvailable = (api: { isAvailable(login: string): Promise<boolean> }) =>
  asyncValidator('loginAvailable', (login: string) => api.isAvailable(login), '%displayName% is already taken');

export const service = createValidationService({
  validators: [multipleOf, maxWords],
  expressionScope: {
    /** True on Saturday and Sunday. */
    isWeekend: (d: Date): boolean => [0, 6].includes(d.getDay()),
    today: () => new Date(),
  },
});
