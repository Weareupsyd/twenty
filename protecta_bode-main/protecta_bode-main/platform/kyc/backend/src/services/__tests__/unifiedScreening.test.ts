import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runScreen: vi.fn(),
  getScreen: vi.fn(),
  generateReference: vi.fn(() => 'SCR-FALLBACK-1'),
  getDataFreshness: vi.fn(async () => ({ dataset_version: 'test-v1', last_successful_sync: null })),
  logScreening: vi.fn(async () => {}),
  createAMLProviders: vi.fn(() => [] as any[]),
  screenAll: vi.fn(),
  linkSubject: vi.fn(async () => {}),
  optionalQuery: vi.fn(async () => [] as any[]),
}));

vi.mock('@/aml/screen.js', () => ({
  runScreen: mocks.runScreen,
  getScreen: mocks.getScreen,
}));
vi.mock('@/aml/audit.js', () => ({
  generateReference: mocks.generateReference,
  getDataFreshness: mocks.getDataFreshness,
  logScreening: mocks.logScreening,
}));
vi.mock('@/providers/aml/index.js', () => ({ createAMLProviders: mocks.createAMLProviders }));
vi.mock('@/providers/aml/multiScreen.js', () => ({ screenAll: mocks.screenAll }));
vi.mock('@/compliance/dualWrite.js', () => ({ linkSubject: mocks.linkSubject }));
vi.mock('@/compliance/query.js', () => ({ optionalQuery: mocks.optionalQuery }));
vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  compactAMLResult,
  findUnifiedScreening,
  runUnifiedScreening,
} from '../unifiedScreening.js';

const fullResult = {
  reference: 'SCR-20260826-FULL',
  status: 'completed' as const,
  query: { entity_type: 'person', name: 'Amina Yusuf' },
  summary: {
    risk_level: 'High',
    match_found: true,
    requires_human_review: true,
    total_matches: 1,
    sanctions_matches: 1,
    pep_related_matches: 0,
  },
  matches: [{
    entity_id: 'Q-1',
    caption: 'Amina Yusuf',
    score: 0.94,
    risk_categories: ['sanction'],
    datasets: ['OFAC SDN'],
    countries: ['ug'],
    source_links: [],
    sanctions: [],
  }],
  relationships: [],
  data_freshness: { dataset_version: '2026-08-25', last_successful_sync: null },
  analyst_note: 'Review required',
  timestamp: '2026-08-26T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAMLProviders.mockReturnValue([]);
  mocks.optionalQuery.mockResolvedValue([]);
  mocks.runScreen.mockResolvedValue(fullResult);
  mocks.getScreen.mockResolvedValue(fullResult);
});

describe('compactAMLResult', () => {
  it('maps a full sanctions hit into the Gate-6 result without dropping evidence', () => {
    const compact = compactAMLResult(fullResult, {
      name: 'Amina Yusuf',
      dateOfBirth: '1987-02-03',
    });

    expect(compact.risk_level).toBe('confirmed_match');
    expect(compact.match_found).toBe(true);
    expect(compact.matches[0]).toMatchObject({
      listed_name: 'Amina Yusuf',
      list_source: 'OFAC SDN',
      score: 0.94,
      match_type: 'name_dob',
    });
  });
});

describe('runUnifiedScreening', () => {
  it('runs one full screen and links its real reference to the verification', async () => {
    const result = await runUnifiedScreening({
      verificationId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      name: ' Amina Yusuf ',
      dateOfBirth: '1987-02-03',
      nationality: 'UGA',
    });

    expect(mocks.runScreen).toHaveBeenCalledOnce();
    expect(result.unified_screening.reference).toBe(fullResult.reference);
    expect(result.risk_level).toBe('confirmed_match');
    expect(mocks.linkSubject).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: '11111111-1111-4111-8111-111111111111',
      screeningRef: fullResult.reference,
      fullName: 'Amina Yusuf',
    }));
    // The native screen already logged itself; no duplicate fallback row.
    expect(mocks.logScreening).not.toHaveBeenCalled();
  });

  it('reuses an existing full link after a retry instead of screening twice', async () => {
    mocks.optionalQuery.mockResolvedValue([{ screening_ref: fullResult.reference }]);

    const result = await runUnifiedScreening({
      verificationId: '11111111-1111-4111-8111-111111111111',
      name: 'Amina Yusuf',
    });

    expect(result.unified_screening.reference).toBe(fullResult.reference);
    expect(mocks.getScreen).toHaveBeenCalledWith(fullResult.reference);
    expect(mocks.runScreen).not.toHaveBeenCalled();
    expect(mocks.linkSubject).not.toHaveBeenCalled();
  });

  it('uses configured providers as a single logged fallback when Yente is unavailable', async () => {
    mocks.runScreen.mockRejectedValue(new Error('yente offline'));
    mocks.createAMLProviders.mockReturnValue([{ name: 'offline' }] as any[]);
    mocks.screenAll.mockResolvedValue({
      risk_level: 'potential_match',
      match_found: true,
      matches: [{ listed_name: 'Amina Y.', list_source: 'PEP', score: 0.7, match_type: 'pep' }],
      lists_checked: ['PEP'],
      screened_name: 'Amina Yusuf',
      screened_dob: null,
      screened_at: '2026-08-26T00:00:00.000Z',
    });

    const result = await runUnifiedScreening({ name: 'Amina Yusuf' });

    expect(result.unified_screening.reference).toBe('SCR-FALLBACK-1');
    expect(result.unified_screening.summary.pep_related_matches).toBe(1);
    expect(mocks.logScreening).toHaveBeenCalledOnce();
  });
});

describe('findUnifiedScreening', () => {
  it('ignores compact SCR-KAB mirrors and returns the newest full link', async () => {
    mocks.optionalQuery.mockResolvedValue([
      { screening_ref: 'SCR-KAB-OLD' },
      { screening_ref: 'SCR-20260826-FULL' },
    ]);

    const result = await findUnifiedScreening('11111111-1111-4111-8111-111111111111');

    expect(mocks.getScreen).toHaveBeenCalledWith('SCR-20260826-FULL');
    expect(result?.reference).toBe('SCR-20260826-FULL');
  });
});
