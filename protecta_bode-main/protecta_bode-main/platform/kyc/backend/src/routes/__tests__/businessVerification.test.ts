/**
 * Route tests for Business Verification (KYB).
 *
 * The service layer is mocked - the aggregation and cross-check rules have
 * their own tests. What matters here is the HTTP contract: tenant scoping,
 * validation, and the shape integrators code against.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockSession: any = null;
let mockDecision: any = null;

vi.mock('@/config/database.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => ({ data: mockSession, error: null })),
    })),
  },
  connectDB: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logError: vi.fn(),
  logVerificationEvent: vi.fn(),
}));

// Auth: API key resolves to developer dev-1; JWT resolves to the same.
vi.mock('@/middleware/auth.js', () => ({
  authenticateAPIKey: (req: any, _res: any, next: any) => {
    req.apiKey = { id: 'key-1', developer_id: 'dev-1' };
    next();
  },
  authenticateDeveloperJWT: (req: any, _res: any, next: any) => {
    req.developer = { id: 'dev-1' };
    next();
  },
  hashHandoffToken: (t: string) => t,
}));

vi.mock('@/middleware/rateLimit.js', () => ({
  basicRateLimit: (_req: any, _res: any, next: any) => next(),
}));

const svc = {
  createBusinessSession: vi.fn(),
  getBusinessSession: vi.fn(),
  listBusinessSessions: vi.fn(),
  setKeyPeople: vi.fn(),
  getKeyPeople: vi.fn(),
  spawnLinkedKyc: vi.fn(),
  recordDocument: vi.fn(),
  getDocuments: vi.fn(),
  runAndStoreCrossCheck: vi.fn(),
  getCrossChecks: vi.fn(),
  runAmlScreening: vi.fn(),
  getAmlScreenings: vi.fn(),
  recomputeVerdict: vi.fn(),
  recordDecision: vi.fn(),
  buildDecisionObject: vi.fn(),
  hashAccessToken: (t: string) => t,
  DEFAULT_REQUIRED_DOCUMENTS: ['certificate_of_incorporation'],
  // Nested KYB is off by default, so these routes behave exactly as before.
  isNestedKybEnabledByDefault: () => false,
  spawnNestedKyb: vi.fn(),
  prepareDirectorVerifications: vi.fn(),
  sendVerificationLinks: vi.fn(),
  getOwnershipResolution: vi.fn(),
  persistEffectiveOwnership: vi.fn(),
};

vi.mock('@/services/kyb/businessSessionService.js', () => svc);

// Workflow settings decide whether a session resolves nested ownership.
// `nestedEnabled` stands in for the whole layering (call > workflow >
// deployment); resolution itself is tested in workflowSettings.test.ts.
let nestedEnabled = false;
let nestedSource: 'call' | 'workflow' | 'deployment' = 'deployment';

const workflowSvc = {
  settingsForSession: vi.fn(async () => ({
    nestedOwnershipEnabled: nestedEnabled,
    autoApproveWhenClean: undefined,
    requiredDocuments: undefined,
    uboThresholdPercentage: undefined,
    source: { nestedOwnership: nestedSource },
  })),
  listWorkflows: vi.fn(async () => []),
  upsertWorkflow: vi.fn(async (_d: string, w: string) => ({ workflow_id: w })),
  getWorkflow: vi.fn(async () => null),
  deploymentNestedDefault: vi.fn(() => false),
  resolveSettings: vi.fn(),
};
vi.mock('@/services/kyb/workflowSettings.js', () => workflowSvc);

const { default: router } = await import('../businessVerification.js');
const { errorHandler } = await import('@/middleware/errorHandler.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v2/business', router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = null;
  mockDecision = null;
  svc.hashAccessToken = (t: string) => t;
  svc.DEFAULT_REQUIRED_DOCUMENTS = ['certificate_of_incorporation'];
  svc.isNestedKybEnabledByDefault = () => false;
  nestedEnabled = false;
  nestedSource = 'deployment';
});

// ── Metadata ───────────────────────────────────────────────────────────────
describe('GET /role-tags', () => {
  it('publishes exactly 15 canonical tags so the UI never hardcodes them', async () => {
    const res = await request(makeApp()).get('/api/v2/business/role-tags');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(15);
    expect(res.body.role_tags).toHaveLength(15);
    const tags = res.body.role_tags.map((r: any) => r.tag);
    expect(tags).toContain('ubo');
    expect(tags).toContain('signatory');
  });

  it('states plainly that registry lookup is not enabled', async () => {
    const res = await request(makeApp()).get('/api/v2/business/role-tags');
    expect(res.body.registry_lookup.enabled).toBe(false);
    expect(res.body.registry_lookup.note).toMatch(/document/i);
  });

  it('reports the nested KYB default as off, and says how to turn it on', async () => {
    const res = await request(makeApp()).get('/api/v2/business/role-tags');
    expect(res.body.nested_kyb.default_enabled).toBe(false);
    expect(res.body.nested_kyb.configurable_per_workflow).toBe(true);
    expect(res.body.nested_kyb.note).toMatch(/per workflow|KYB_NESTED_OWNERSHIP/);
  });

  it('reports the default as on once the deployment enables it', async () => {
    svc.isNestedKybEnabledByDefault = () => true;
    const res = await request(makeApp()).get('/api/v2/business/role-tags');
    expect(res.body.nested_kyb.default_enabled).toBe(true);
    expect(res.body.nested_kyb.note).toMatch(/ownership/i);
  });
});

// ── Nested KYB toggle ──────────────────────────────────────────────────────
describe('nested KYB switching', () => {
  const postPeople = () =>
    request(makeApp())
      .put('/api/v2/business/hosted/tok/key-people')
      .send({ key_people: [{ full_name: 'Opaque Holdings Ltd', role_tags: ['shareholder'] }] });

  beforeEach(() => {
    mockSession = {
      id: 'bs_1', developer_id: 'dev-1', status: 'IN_PROGRESS',
      root_session_id: null, access_token_expires_at: '2099-01-01T00:00:00Z',
    };
    svc.getBusinessSession.mockResolvedValue(mockSession);
    svc.setKeyPeople.mockResolvedValue({ keyPeople: [{ id: 'p1' }], unmapped: [] });
    svc.spawnLinkedKyc.mockResolvedValue([]);
    svc.runAmlScreening.mockResolvedValue(undefined);
    svc.recomputeVerdict.mockResolvedValue({ status: 'IN_REVIEW', ubo_kyc_summary: {} });
    svc.spawnNestedKyb.mockResolvedValue({
      spawned: [{ person_id: 'p1', child_session_id: 'bs_2', access_token: 't' }],
      skipped: [],
    });
  });

  it('does not spawn child sessions while the toggle is off', async () => {
    nestedEnabled = false;
    const res = await postPeople();
    expect(res.status).toBe(200);
    expect(svc.spawnNestedKyb).not.toHaveBeenCalled();
    // Absent, not false - "not evaluated" must be distinguishable from "clean".
    expect(res.body.nested_kyb_spawned).toBeUndefined();
  });

  it('spawns a child session for a corporate owner when the toggle is on', async () => {
    nestedEnabled = true;
    const res = await postPeople();
    expect(res.status).toBe(200);
    expect(svc.spawnNestedKyb).toHaveBeenCalledWith('bs_1', 'dev-1');
    expect(res.body.nested_kyb_spawned).toBe(1);
  });

  it('surfaces an owner it refused to spawn rather than dropping it silently', async () => {
    nestedEnabled = true;
    svc.spawnNestedKyb.mockResolvedValue({
      spawned: [],
      skipped: [{ person_id: 'p1', name: 'Circular Ltd', reason: 'Circular ownership detected' }],
    });
    const res = await postPeople();
    expect(res.body.nested_kyb_skipped).toHaveLength(1);
    expect(res.body.nested_kyb_skipped[0].reason).toMatch(/circular/i);
  });

  it('persists effective ownership only when the toggle is on', async () => {
    nestedEnabled = false;
    await postPeople();
    expect(svc.persistEffectiveOwnership).not.toHaveBeenCalled();

    nestedEnabled = true;
    await postPeople();
    expect(svc.persistEffectiveOwnership).toHaveBeenCalledWith('bs_1');
  });
});

// ── Ownership graph endpoint ───────────────────────────────────────────────
describe('GET /sessions/:id/ownership', () => {
  beforeEach(() => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', status: 'IN_PROGRESS', root_session_id: null };
    svc.getBusinessSession.mockResolvedValue(mockSession);
  });

  it('says nested KYB is off rather than returning an empty graph', async () => {
    nestedEnabled = false;
    const res = await request(makeApp()).get('/api/v2/business/sessions/bs_1/ownership');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.beneficial_owners).toBeUndefined();
  });

  it('returns the resolved graph when nested KYB is on', async () => {
    nestedEnabled = true;
    svc.getOwnershipResolution.mockResolvedValue({
      resolved: false, opaque_percentage: 20, traced_percentage: 80,
      beneficial_owners: [{ full_name: 'Amina', effective_percentage: 80 }],
      unresolved_owners: [{ name: 'Opaque Holdings Ltd' }],
    });
    const res = await request(makeApp()).get('/api/v2/business/sessions/bs_1/ownership');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.opaque_percentage).toBe(20);
    expect(res.body.unresolved_owners[0].name).toBe('Opaque Holdings Ltd');
  });

  it('does not leak another developer\'s ownership graph', async () => {
    nestedEnabled = true;
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_1', developer_id: 'someone-else' });
    const res = await request(makeApp()).get('/api/v2/business/sessions/bs_1/ownership');
    expect(res.status).toBe(404);
    expect(svc.getOwnershipResolution).not.toHaveBeenCalled();
  });
});

// ── Session creation ───────────────────────────────────────────────────────
describe('POST /session', () => {
  it('creates a business session and returns the hosted url', async () => {
    svc.createBusinessSession.mockResolvedValue({
      session: {
        id: 'bs_1', session_number: 7, vendor_data: 'biz-acme-001',
        status: 'NOT_STARTED', access_token_expires_at: '2026-09-01T00:00:00Z',
      },
      accessToken: 'tok_abc',
    });

    const res = await request(makeApp())
      .post('/api/v2/business/session')
      .send({ workflow_id: 'wf_kyb_1', vendor_data: 'biz-acme-001' });

    expect(res.status).toBe(201);
    expect(res.body.session_kind).toBe('business');
    expect(res.body.session_id).toBe('bs_1');
    expect(res.body.url).toContain('tok_abc');
    expect(svc.createBusinessSession).toHaveBeenCalledWith(
      expect.objectContaining({ developerId: 'dev-1', workflowId: 'wf_kyb_1' }),
    );
  });
});

// ── Tenant scoping ─────────────────────────────────────────────────────────
describe('tenant isolation', () => {
  it('404s a session belonging to another developer', async () => {
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_9', developer_id: 'someone-else' });
    const res = await request(makeApp()).get('/api/v2/business/session/bs_9/decision');
    expect(res.status).toBe(404);
    expect(svc.buildDecisionObject).not.toHaveBeenCalled();
  });

  it('404s a session that does not exist', async () => {
    svc.getBusinessSession.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/v2/business/session/nope/decision');
    expect(res.status).toBe(404);
  });

  it('returns the decision for a session the developer owns', async () => {
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_1', developer_id: 'dev-1' });
    svc.buildDecisionObject.mockResolvedValue({
      session_id: 'bs_1', session_kind: 'business', status: 'APPROVED',
      registry_status: 'DEFERRED', key_people_checks: [],
    });
    const res = await request(makeApp()).get('/api/v2/business/session/bs_1/decision');
    expect(res.status).toBe(200);
    expect(res.body.session_kind).toBe('business');
    expect(res.body.registry_status).toBe('DEFERRED');
  });
});

// ── Hosted flow ────────────────────────────────────────────────────────────
describe('hosted flow', () => {
  it('rejects an unknown access token', async () => {
    mockSession = null;
    const res = await request(makeApp()).get('/api/v2/business/hosted/bad-token');
    expect(res.status).toBe(401);
  });

  it('rejects an expired link', async () => {
    mockSession = {
      id: 'bs_1', developer_id: 'dev-1',
      access_token_expires_at: '2020-01-01T00:00:00Z',
    };
    const res = await request(makeApp()).get('/api/v2/business/hosted/tok');
    expect(res.status).toBe(401);
    expect(res.body.error || res.body.message).toMatch(/expired/i);
  });

  it('bootstraps the page for a live link', async () => {
    mockSession = {
      id: 'bs_1', developer_id: 'dev-1', status: 'IN_PROGRESS',
      access_token_expires_at: '2099-01-01T00:00:00Z',
      user_provided_data: { legal_name: 'Acme Ltd' },
    };
    svc.getKeyPeople.mockResolvedValue([]);
    svc.getDocuments.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/v2/business/hosted/tok');
    expect(res.status).toBe(200);
    expect(res.body.role_tags).toHaveLength(15);
    expect(res.body.company.legal_name).toBe('Acme Ltd');
  });

  it('requires every key person to carry at least one role tag', async () => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', access_token_expires_at: '2099-01-01T00:00:00Z' };
    const res = await request(makeApp())
      .put('/api/v2/business/hosted/tok/key-people')
      .send({ key_people: [{ full_name: 'Amina', role_tags: [] }] });
    expect(res.status).toBe(400);
    expect(svc.setKeyPeople).not.toHaveBeenCalled();
  });

  it('requires a name on each key person', async () => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', access_token_expires_at: '2099-01-01T00:00:00Z' };
    const res = await request(makeApp())
      .put('/api/v2/business/hosted/tok/key-people')
      .send({ key_people: [{ role_tags: ['ubo'] }] });
    expect(res.status).toBe(400);
  });

  it('spawns linked KYC and surfaces unmapped roles rather than dropping them', async () => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', access_token_expires_at: '2099-01-01T00:00:00Z' };
    svc.setKeyPeople.mockResolvedValue({
      keyPeople: [{ id: 'p1' }],
      unmapped: [{ name: 'Amina', unmapped: ['Grand Vizier'] }],
    });
    svc.spawnLinkedKyc.mockResolvedValue([{ person_id: 'p1', verification_id: 'vr_1' }]);
    svc.runAmlScreening.mockResolvedValue({ entity: null, people: [] });
    svc.recomputeVerdict.mockResolvedValue({
      status: 'AWAITING_USER', reasons: [],
      ubo_kyc_summary: { required: 1, resolved: 0, approved: 0, declined: 0, pending: 1 },
    });

    const res = await request(makeApp())
      .put('/api/v2/business/hosted/tok/key-people')
      .send({ key_people: [{ full_name: 'Amina', role_tags: ['ubo', 'Grand Vizier'] }] });

    expect(res.status).toBe(200);
    expect(res.body.linked_kyc_spawned).toBe(1);
    expect(res.body.unmapped_roles[0].unmapped).toContain('Grand Vizier');
    expect(res.body.status).toBe('AWAITING_USER');
  });

  it('re-runs the cross-check when a document lands', async () => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', access_token_expires_at: '2099-01-01T00:00:00Z' };
    svc.recordDocument.mockResolvedValue({ id: 'doc_1', status: 'PROCESSED' });
    svc.runAndStoreCrossCheck.mockResolvedValue([]);
    svc.recomputeVerdict.mockResolvedValue({ status: 'IN_REVIEW', reasons: [] });

    const res = await request(makeApp())
      .post('/api/v2/business/hosted/tok/document')
      .send({ document_type: 'certificate_of_incorporation', ocr_data: { legal_name: 'Acme Ltd' } });

    expect(res.status).toBe(201);
    expect(svc.runAndStoreCrossCheck).toHaveBeenCalledWith('bs_1');
    expect(res.body.status).toBe('IN_REVIEW');
  });

  it('rejects a document with no type', async () => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', access_token_expires_at: '2099-01-01T00:00:00Z' };
    const res = await request(makeApp())
      .post('/api/v2/business/hosted/tok/document')
      .send({ ocr_data: {} });
    expect(res.status).toBe(400);
  });
});

// ── Director verification links ────────────────────────────────────────────
describe('director verification links', () => {
  beforeEach(() => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', access_token_expires_at: '2099-01-01T00:00:00Z' };
  });

  it('creates verification sessions for key people via the hosted flow', async () => {
    svc.prepareDirectorVerifications.mockResolvedValue([
      {
        person_id: 'p1', full_name: 'Amina', verification_id: 'vr_1',
        session_token: 'abc', verification_url: 'https://verify.example/user-verification?session=abc',
      },
    ]);

    const res = await request(makeApp())
      .post('/api/v2/business/hosted/tok/key-people/create-sessions');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.sessions[0].verification_url).toContain('session=abc');
    expect(svc.prepareDirectorVerifications).toHaveBeenCalledWith(
      'bs_1', 'dev-1', expect.objectContaining({}),
    );
  });

  it('sends verification links and returns delivery status', async () => {
    svc.sendVerificationLinks.mockResolvedValue([
      {
        person_id: 'p1', full_name: 'Amina',
        email_sent: true, sms_sent: false,
        verification_url: 'https://verify.example/user-verification?session=abc',
      },
    ]);

    const res = await request(makeApp())
      .post('/api/v2/business/hosted/tok/key-people/send-links')
      .send({ contacts: { p1: { email: 'amina@example.com' } } });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].email_sent).toBe(true);
    expect(svc.sendVerificationLinks).toHaveBeenCalledWith(
      'bs_1', 'dev-1',
      expect.objectContaining({ contacts: expect.objectContaining({ p1: { email: 'amina@example.com' } }) }),
    );
  });

  it('rejects non-object contacts', async () => {
    const res = await request(makeApp())
      .post('/api/v2/business/hosted/tok/key-people/send-links')
      .send({ contacts: ['not-an-object'] });
    expect(res.status).toBe(400);
    expect(svc.sendVerificationLinks).not.toHaveBeenCalled();
  });

  it('exposes the integrator verify-directors endpoint, scoped to the developer', async () => {
    svc.prepareDirectorVerifications.mockResolvedValue([
      {
        person_id: 'p1', full_name: 'Amina', verification_id: 'vr_1',
        session_token: 'abc', verification_url: 'https://verify.example/user-verification?session=abc',
      },
    ]);

    const res = await request(makeApp())
      .post('/api/v2/business/session/bs_1/verify-directors')
      .send({ contacts: { p1: { email: 'amina@example.com' } } });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(svc.prepareDirectorVerifications).toHaveBeenCalledWith(
      'bs_1', 'dev-1', expect.objectContaining({ contacts: expect.objectContaining({ p1: expect.anything() }) }),
    );
  });

  it('does not leak another developer\'s verify-directors', async () => {
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_9', developer_id: 'someone-else' });
    const res = await request(makeApp())
      .post('/api/v2/business/session/bs_9/verify-directors')
      .send({ contacts: {} });
    expect(res.status).toBe(404);
    expect(svc.prepareDirectorVerifications).not.toHaveBeenCalled();
  });

  it('allows the integrator to set key people programmatically', async () => {
    mockSession = { id: 'bs_1', developer_id: 'dev-1', status: 'IN_PROGRESS' };
    svc.setKeyPeople.mockResolvedValue({ keyPeople: [{ id: 'p1' }], unmapped: [] });
    svc.spawnLinkedKyc.mockResolvedValue([{ person_id: 'p1', verification_id: 'vr_1' }]);
    svc.runAmlScreening.mockResolvedValue({ entity: null, people: [] });
    svc.recomputeVerdict.mockResolvedValue({ status: 'AWAITING_USER', reasons: [] });

    const res = await request(makeApp())
      .put('/api/v2/business/session/bs_1/key-people')
      .send({ key_people: [{ full_name: 'Amina', role_tags: ['director'] }] });

    expect(res.status).toBe(200);
    expect(res.body.key_people).toBe(1);
    expect(res.body.linked_kyc_spawned).toBe(1);
    expect(svc.setKeyPeople).toHaveBeenCalledWith('bs_1', [{ full_name: 'Amina', role_tags: ['director'] }]);
  });
});

// ── Analyst surface ────────────────────────────────────────────────────────
describe('analyst surface', () => {
  it('lists sessions scoped to the developer', async () => {
    svc.listBusinessSessions.mockResolvedValue({ sessions: [], total: 0, page: 1, limit: 20 });
    const res = await request(makeApp()).get('/api/v2/business/sessions?status=IN_REVIEW');
    expect(res.status).toBe(200);
    expect(svc.listBusinessSessions).toHaveBeenCalledWith('dev-1', expect.objectContaining({ status: 'IN_REVIEW' }));
  });

  it('validates the decision value', async () => {
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_1', developer_id: 'dev-1' });
    const res = await request(makeApp())
      .post('/api/v2/business/sessions/bs_1/decision')
      .send({ decision: 'MAYBE' });
    expect(res.status).toBe(400);
    expect(svc.recordDecision).not.toHaveBeenCalled();
  });

  it('records a valid decision', async () => {
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_1', developer_id: 'dev-1' });
    svc.recordDecision.mockResolvedValue({ status: 'APPROVED', decided_at: '2026-08-15T00:00:00Z' });
    const res = await request(makeApp())
      .post('/api/v2/business/sessions/bs_1/decision')
      .send({ decision: 'APPROVED', note: 'Register reconciles' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('will not let a developer decide on a session they do not own', async () => {
    svc.getBusinessSession.mockResolvedValue({ id: 'bs_1', developer_id: 'other' });
    const res = await request(makeApp())
      .post('/api/v2/business/sessions/bs_1/decision')
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(404);
    expect(svc.recordDecision).not.toHaveBeenCalled();
  });
});
