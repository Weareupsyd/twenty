import { describe, expect, it } from 'vitest';
import { hasScope } from 'src/lib/partner-scopes';

describe('hasScope', () => {
  it('matches granted scopes', () => {
    expect(hasScope(['quotes:write'], 'quotes:write')).toBe(true);
    expect(hasScope(['QUOTES_WRITE'], 'quotes:write')).toBe(true);
    expect(hasScope(['quotes:write'], 'claims:write')).toBe(false);
    expect(hasScope('quotes:write', 'quotes:write')).toBe(true);
    expect(hasScope(null, 'quotes:write')).toBe(false);
  });
});
