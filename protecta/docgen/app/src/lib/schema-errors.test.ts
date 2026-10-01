import { describe, expect, it } from 'vitest';
import {
  missingSchemaField,
  staleClientMessage,
} from 'src/lib/schema-errors';

describe('stale generated client errors', () => {
  it('names the object a client cannot query', () => {
    expect(
      missingSchemaField(
        new Error('type `Query` does not have a field `insurancePolicies`'),
      ),
    ).toBe('insurancePolicies');
    expect(
      missingSchemaField(
        'type `Query` does not have a field `generatedDocuments`',
      ),
    ).toBe('generatedDocuments');
  });

  it('leaves every other failure alone', () => {
    expect(missingSchemaField(new Error('network unreachable'))).toBeNull();
    expect(missingSchemaField(undefined)).toBeNull();
    expect(
      missingSchemaField(new Error('Cannot query field "x" on type "Query".')),
    ).toBeNull();
  });

  it('explains the fix in the message it reports', () => {
    const message = staleClientMessage('insurancePolicies');

    expect(message).toContain('insurancePolicies');
    expect(message).toContain('./start.sh');
    expect(message).toContain('./twenty.sh docgen apply .');
  });
});
