import { type DbClient, type RecordData } from 'src/lib/records';

export type GenerateRefConfig = {
  objectSingular: string;
  /** The customer-facing reference field, e.g. 'claimRef'. */
  refField: string;
  makeRef: () => string;
};

export type RefFillResult = { processed: boolean; ref: string | null };

/**
 * Generate a record's reference when it was created without one.
 *
 * Records created through the service layer (bot, portal, partner API)
 * already carry a reference from `src/lib/refs`; those are left untouched.
 * Records created straight from the CRM UI would otherwise show an empty
 * label identifier, so the `.created` event handlers call this to fill the
 * gap. An existing `protectaRef` is never overwritten — when empty it is
 * mirrored from the generated reference, matching the service layer.
 */
export const fillMissingRef = async (
  db: DbClient,
  record: RecordData,
  config: GenerateRefConfig,
  options: { maxAttempts?: number } = {},
): Promise<RefFillResult> => {
  const existing = record[config.refField];
  if (typeof existing === 'string' && existing.trim().length > 0) {
    return { processed: false, ref: existing.trim() };
  }
  const recordId = String(record.id);
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ref = config.makeRef();
    try {
      await db.update(config.objectSingular, recordId, {
        [config.refField]: ref,
        ...(String(record.protectaRef ?? '').trim()
          ? {}
          : { protectaRef: ref }),
      });
      return { processed: true, ref };
    } catch (error) {
      // A generated reference can theoretically collide with the unique
      // constraint of an existing record; draw another one and retry.
      lastError = error;
    }
  }
  throw lastError;
};
