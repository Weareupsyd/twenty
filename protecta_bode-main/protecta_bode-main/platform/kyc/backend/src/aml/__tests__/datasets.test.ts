import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.OPENSANCTIONS_DATA_DIR = `/tmp/kyc-dataset-test-${process.pid}`;
  process.env.OPENSANCTIONS_ENTITIES_URL = 'https://data.example.test/entities.ftm.json';
  return {
    amlQuery: vi.fn(),
    createWriteStream: vi.fn(),
    pingYenteUpdate: vi.fn(),
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, createWriteStream: mocks.createWriteStream };
});

vi.mock('../db.js', () => ({ amlQuery: mocks.amlQuery }));
vi.mock('../yente.js', () => ({
  pingYenteUpdate: mocks.pingYenteUpdate,
  getYenteDatasetStats: vi.fn(async () => ({ version: null, entity_count: null })),
}));

import { rm } from 'node:fs/promises';
import { triggerReindex } from '../datasets.js';

const originalFetch = globalThis.fetch;

describe('dataset reindex orchestration', () => {
  beforeEach(() => {
    mocks.amlQuery.mockReset();
    mocks.createWriteStream.mockReset();
    mocks.pingYenteUpdate.mockReset();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {},
    }) as typeof fetch;

    const permissionError = Object.assign(
      new Error("EACCES: permission denied, open '/data/opensanctions/current/entities.ftm.json.part'"),
      { code: 'EACCES' },
    );
    mocks.createWriteStream.mockImplementation(() => { throw permissionError; });
    mocks.amlQuery.mockResolvedValue({ rows: [{ id: 42 }] });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(process.env.OPENSANCTIONS_DATA_DIR!, { recursive: true, force: true });
  });

  it('fails the sync and does not reindex stale data when the download is not writable', async () => {
    const result = await triggerReindex();

    expect(result).toEqual({
      sync_id: 42,
      status: 'failed',
      message: expect.stringContaining('EACCES: permission denied'),
      bytes: 0,
    });
    expect(result.message).toContain('yente reindex skipped because dataset download failed');
    expect(mocks.pingYenteUpdate).not.toHaveBeenCalled();
    expect(mocks.amlQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO aml.dataset_syncs'),
      expect.arrayContaining(['failed']),
    );
  });
});
