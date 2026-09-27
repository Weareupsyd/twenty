/**
 * Opt-in PostgreSQL regression for the community boot order and verification
 * request schema repairs.
 * KYC_TEST_DATABASE_URL must point at a TEST server with CREATEDB permission.
 * Each test creates/drops its own randomly named database, never the supplied DB.
 *
 * KYC_TEST_DATABASE_URL=postgresql://.../postgres npm test -- --run \
 *   src/scripts/__tests__/verificationAddons.migration.test.ts
 */
import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgQueryBuilder } from '@/adapters/pg/PgQueryBuilder.js';

const database = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/config/database.js', () => ({
  supabase: { from: (table: string) => database.from(table) },
}));
// Initialization does not perform geolocation; avoid the eager Tor HTTP fetch.
vi.mock('@/services/geoAnalysis.js', () => ({ analyzeGeoRisk: vi.fn() }));

const adminUrl = process.env.KYC_TEST_DATABASE_URL;
const backendDir = fileURLToPath(new URL('../../../', import.meta.url));
const migrationDirs = {
  core: fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url)),
  compliance: fileURLToPath(new URL('../../../../compliance-migrations/', import.meta.url)),
};
const repairs = {
  core: [
    '70_add_verification_addons.sql',
    '71_add_verification_request_ocr_data.sql',
  ],
  compliance: [
    '0015_verification_addons.sql',
    '0016_verification_request_ocr_data.sql',
  ],
};
const exec = promisify(execFile);

describe.skipIf(!adminUrl)('verification-request schema repairs - PostgreSQL migrations', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let databaseName: string;
  let databaseUrl: string;
  let app: express.Express;
  let apiKeySecret: string;
  let apiKey: string;
  let developerId: string;
  let scratch: string;

  beforeAll(async () => {
    // Keep this regression independent of a developer's cloud/ML configuration.
    vi.stubEnv('RATE_LIMIT_ENABLED', 'false');
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('AML_TS_PORT', 'false');
    vi.stubEnv('YENTE_URL', '');
    const config = (await import('@/config/index.js')).default;
    apiKeySecret = config.apiKeySecret;
    app = express();
    app.use(express.json());
    app.use('/api/health', (await import('@/routes/health.js')).default);
    app.use('/api/v2/verify', (await import('@/routes/newVerification.js')).default);
    app.use((await import('@/middleware/errorHandler.js')).errorHandler);
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect();
  }, 20000);

  beforeEach(async () => {
    databaseName = `kyc_schema_repair_test_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    pool = new pg.Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 });
    database.from.mockImplementation(table => new PgQueryBuilder(pool, table));
    scratch = await mkdtemp(join(tmpdir(), 'kyc-schema-repairs-'));
  });

  afterEach(async () => {
    if (pool) await pool.end();
    if (databaseName) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (admin) await admin.end();
    vi.unstubAllEnvs();
  });

  async function migrate(stage: keyof typeof migrationDirs, legacy = false) {
    let dir = migrationDirs[stage];
    if (legacy) {
      // Run the real runner against the exact pre-fix files, including tracking
      // names. This reproduces core CREATE -> compliance CREATE IF NOT EXISTS.
      dir = join(scratch, stage);
      await cp(migrationDirs[stage], dir, { recursive: true });
      await Promise.all(repairs[stage].map(repair => rm(join(dir, repair))));
    }
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', 'src/scripts/migrate.ts'], {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_SSL: 'false',
        MIGRATIONS_DIR: dir,
        MIGRATIONS_LENIENT: 'true',
      },
      timeout: 20000,
    });
    return stdout;
  }

  async function seedKey() {
    developerId = (await pool.query(
      "INSERT INTO developers (email, name, is_verified) VALUES ('kyc-test@example.test', 'KYC test', true) RETURNING id",
    )).rows[0].id;
    apiKey = `ik_${randomBytes(32).toString('hex')}`;
    await pool.query(
      'INSERT INTO api_keys (developer_id, key_hash, key_prefix, name) VALUES ($1, $2, $3, $4)',
      [developerId, createHmac('sha256', apiKeySecret).update(apiKey).digest('hex'), apiKey.slice(0, 8), 'KYC test'],
    );
  }

  function initialize(addons?: Record<string, unknown>, key = apiKey) {
    return request(app).post('/api/v2/verify/initialize').set('X-API-Key', key).send({
      user_id: 'agrilink-healthcheck', document_type: 'national_id', issuing_country: 'UG',
      ...(addons === undefined ? {} : { addons }),
    });
  }

  async function expectInitializationWorks() {
    const addons = { aml_screening: false, address_verification: true };
    const response = await initialize(addons);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const { rows: [record] } = await pool.query(
      'SELECT * FROM verification_requests WHERE id = $1', [response.body.verification_id],
    );
    expect(record.addons).toEqual(addons); // explicit false must not be dropped
    expect(record.external_user_id).toBe('agrilink-healthcheck');
    expect(record.verification_mode).toBe('full');
    expect(record.session_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.session_token_hash).not.toBe(response.body.session_token);
    expect(record.session_token_expires_at).not.toBeNull();
    expect(record.step_timestamps.init).toBeTruthy();
    expect((await pool.query(
      'SELECT context FROM verification_contexts WHERE verification_id = $1', [record.id],
    )).rowCount).toBe(1);
    const noAddons = await initialize();
    expect(noAddons.status).toBe(201);
    expect((await pool.query(
      'SELECT addons FROM verification_requests WHERE id = $1', [noAddons.body.verification_id],
    )).rows[0].addons).toBeNull();
    return record;
  }

  it('boots an empty database and initializes with and without add-ons', async () => {
    await migrate('core');
    await migrate('compliance');
    await seedKey();
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
    await expectInitializationWorks();
    // Authentication remains enforced - schema repair is not an auth bypass.
    expect((await initialize({ aml_screening: false }, 'ik_invalid')).status).toBe(401);
  }, 30000);

  it.each(['core', 'compliance'] as const)(
    'repairs an already-migrated database via %s without losing data', async stage => {
      await migrate('core', true);
      await migrate('compliance', true);
      await seedKey();
      const userId = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
      const original = (await pool.query(
        "INSERT INTO verification_requests (user_id, developer_id, status) VALUES ($1, $2, 'verified') RETURNING *",
        [userId, developerId],
      )).rows[0];
      expect((await pool.query("SELECT name FROM _migrations WHERE name = '0013_public_verification_tables.sql'")).rowCount).toBe(1);
      await expect(pool.query('SELECT addons, ocr_data FROM verification_requests LIMIT 0')).rejects.toMatchObject({ code: '42703' });
      // This is the same write the front-document endpoint performs after OCR.
      await expect(pool.query(
        'UPDATE verification_requests SET ocr_data = $1 WHERE id = $2',
        [{ full_name: 'Test user' }, original.id],
      )).rejects.toMatchObject({ code: '42703' });
      expect((await request(app).get('/api/health/ready')).status).toBe(503);
      expect((await initialize({ aml_screening: false })).status).toBe(500);

      const output = await migrate(stage);
      for (const repair of repairs[stage]) expect(output).toContain(` ${repair}`);
      expect((await request(app).get('/api/health/ready')).status).toBe(200);
      expect((await pool.query('SELECT * FROM verification_requests WHERE id = $1', [original.id])).rows[0])
        .toEqual({ ...original, addons: null, ocr_data: null });
      const ocrData = { full_name: 'Test user', id_number: 'TEST-ID-123' };
      await pool.query(
        'UPDATE verification_requests SET ocr_data = $1 WHERE id = $2',
        [ocrData, original.id],
      );
      expect((await pool.query('SELECT ocr_data FROM verification_requests WHERE id = $1', [original.id])).rows[0].ocr_data)
        .toEqual(ocrData);
      const created = await expectInitializationWorks();

      // Replaying either repair set (even with values present) is harmless.
      for (const kind of ['core', 'compliance'] as const) {
        for (const repair of repairs[kind]) {
          await pool.query(await readFile(join(migrationDirs[kind], repair), 'utf8'));
        }
      }
      await migrate('core');
      await migrate('compliance');
      expect((await pool.query('SELECT * FROM verification_requests WHERE id = $1', [created.id])).rows[0])
        .toEqual(created);
      const replay = await migrate(stage);
      for (const repair of repairs[stage]) expect(replay).toContain(`${repair} (already applied)`);
    }, 30000,
  );
});
