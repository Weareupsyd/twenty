/**
 * Business Verification (KYB) routes.
 *
 * Three audiences share this router:
 *   • integrators   - create a session, read the decision   (X-API-Key)
 *   • the business  - the hosted flow                        (access token)
 *   • analysts      - the review surface                     (developer JWT)
 *
 * KYB is workflow-typed: a session created against a Business Verification
 * workflow_id IS a business session. There is no separate business flag and
 * no standalone /business-verification/ endpoint.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { supabase } from '@/config/database.js';
import { catchAsync, ValidationError, NotFoundError, AuthenticationError } from '@/middleware/errorHandler.js';
import { authenticateAPIKey, authenticateDeveloperJWT } from '@/middleware/auth.js';
import { basicRateLimit } from '@/middleware/rateLimit.js';
import { logger } from '@/utils/logger.js';

import {
  createBusinessSession,
  getBusinessSession,
  listBusinessSessions,
  setKeyPeople,
  getKeyPeople,
  spawnLinkedKyc,
  recordDocument,
  getDocuments,
  runAndStoreCrossCheck,
  getCrossChecks,
  runAmlScreening,
  getAmlScreenings,
  recomputeVerdict,
  recordDecision,
  buildDecisionObject,
  hashAccessToken,
  DEFAULT_REQUIRED_DOCUMENTS,
  isNestedKybEnabledByDefault,
  spawnNestedKyb,
  getOwnershipResolution,
  persistEffectiveOwnership,
  prepareDirectorVerifications,
  sendVerificationLinks,
} from '@/services/kyb/businessSessionService.js';
import {
  settingsForSession,
  listWorkflows,
  upsertWorkflow,
  getWorkflow,
} from '@/services/kyb/workflowSettings.js';
import { ROLE_TAGS } from '@/services/kyb/roleTags.js';
import { ingestCompanyDocument, assessTamperSignals } from '@/services/kyb/companyDocumentService.js';
import { isCompanyDocumentType, COMPANY_DOCUMENT_TYPES } from '@/services/kyb/companyDocumentExtractor.js';
import { validateFileType } from '@/middleware/fileValidation.js';

const router = express.Router();

// Company documents are often multi-page scans, so allow more headroom than
// the 10 MB used for a single ID photo. Kept in memory: the buffer goes
// straight to OCR and then to storage, never to a temp file on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function developerIdFrom(req: Request): string {
  const fromKey = (req as any).apiKey?.developer_id;
  const fromJwt = (req as any).developer?.id;
  const id = fromKey || fromJwt;
  if (!id) throw new AuthenticationError('Unable to resolve developer scope');
  return id;
}

/**
 * Ownership check. A business session belongs to exactly one developer, and
 * every read/write below is scoped through this - without it, a valid API key
 * from tenant A could read tenant B's company documents by guessing an id.
 */
async function loadOwnedSession(sessionId: string, developerId: string) {
  const session = await getBusinessSession(sessionId);
  if (!session || session.developer_id !== developerId) {
    throw new NotFoundError('Business session not found');
  }
  return session;
}

/** Resolve a hosted-flow token to its session. */
async function loadSessionByToken(token: string) {
  const { data } = await supabase
    .from('business_sessions')
    .select('*')
    .eq('access_token_hash', hashAccessToken(token))
    .single();

  if (!data) throw new AuthenticationError('Invalid or expired verification link');
  if (data.access_token_expires_at && new Date(data.access_token_expires_at) < new Date()) {
    throw new AuthenticationError('This verification link has expired');
  }
  return data;
}

// ── Metadata ───────────────────────────────────────────────────────────────

/** The canonical role tags, so the frontend never hardcodes its own list. */
router.get('/role-tags', basicRateLimit, (_req: Request, res: Response) => {
  res.json({
    count: ROLE_TAGS.length,
    role_tags: ROLE_TAGS.map((r) => ({
      tag: r.tag,
      group: r.group,
      label: r.label,
      default_kyc_required: r.defaultKycRequired,
      resolves_to_nested_kyb: r.resolvesToNestedKyb ?? false,
      carries_ownership: r.carriesOwnership ?? false,
      description: r.description,
    })),
    required_documents: DEFAULT_REQUIRED_DOCUMENTS,
    nested_kyb: {
      // The deployment default. Any workflow can override it for itself, so
      // this is what a session gets when its workflow says nothing.
      default_enabled: isNestedKybEnabledByDefault(),
      configurable_per_workflow: true,
      note: isNestedKybEnabledByDefault()
        ? 'On by default: corporate owners open their own child business session, so the ownership chain resolves to natural persons. An unresolved corporate owner holds the parent out of approval. Individual workflows may switch it off.'
        : 'Off by default: corporate owners are recorded but not resolved further. Switch it on per workflow via PUT /workflows/:workflow_id, or deployment-wide with KYB_NESTED_OWNERSHIP=true.',
    },
    registry_lookup: {
      enabled: false,
      note: 'Document-first release. Company fields are extracted from uploaded documents and cross-checked against each other and the administrator input. No external registry search runs yet.',
    },
  });
});

// ── Integrator API ─────────────────────────────────────────────────────────

/**
 * POST /api/v2/business/session
 * Create a business session. Returns the hosted URL to hand to the business.
 */
router.post('/session',
  authenticateAPIKey,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const { workflow_id, vendor_data, company } = req.body ?? {};

    const { session, accessToken } = await createBusinessSession({
      developerId,
      workflowId: workflow_id ?? null,
      vendorData: vendor_data ?? null,
      userProvidedData: company ?? {},
    });

    const base = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '';
    res.status(201).json({
      session_id: session.id,
      business_session_id: session.id,
      session_kind: 'business',
      session_number: session.session_number,
      vendor_data: session.vendor_data,
      status: session.status,
      url: base ? `${base}/b/${accessToken}` : `/b/${accessToken}`,
      expires_at: session.access_token_expires_at,
    });
  }),
);

/** GET /api/v2/business/session/:id/decision */
router.get('/session/:id/decision',
  authenticateAPIKey,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    await loadOwnedSession(req.params.id, developerId);
    const decision = await buildDecisionObject(req.params.id);
    if (!decision) throw new NotFoundError('Business session not found');
    res.json(decision);
  }),
);

/** GET /api/v2/business/session/:id - lighter status poll. */
router.get('/session/:id',
  authenticateAPIKey,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const session = await loadOwnedSession(req.params.id, developerId);
    res.json({
      session_id: session.id,
      session_kind: 'business',
      status: session.status,
      previous_status: session.previous_status,
      vendor_data: session.vendor_data,
      legal_name: session.legal_name,
      updated_at: session.updated_at,
    });
  }),
);

/**
 * PUT /api/v2/business/session/:id/key-people
 *
 * Integrator API - set the key people (directors/UBOs) for a business session.
 * Accepts the same shape as the hosted flow:
 *   { key_people: [{ full_name, role_tags, ownership_percentage?, email?, phone?, is_corporate? }] }
 *
 * After saving, linked KYC requests are spawned and AML screening is run
 * against the company entity and each key person.
 */
router.put('/session/:id/key-people',
  authenticateAPIKey,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const session = await loadOwnedSession(req.params.id, developerId);

    const people = req.body?.key_people;
    if (!Array.isArray(people)) throw new ValidationError('key_people array is required', 'key_people', people);

    for (const p of people) {
      if (!p?.full_name) throw new ValidationError('Each key person needs a full_name', 'full_name', p?.full_name);
      if (!Array.isArray(p.role_tags) || p.role_tags.length === 0) {
        throw new ValidationError(`Key person "${p.full_name}" needs at least one role tag`, 'role_tags', p.role_tags);
      }
    }

    const { keyPeople, unmapped } = await setKeyPeople(session.id, people);
    const spawned = await spawnLinkedKyc(session.id, developerId);
    await runAmlScreening(session.id);
    const outcome = await recomputeVerdict(session.id);

    res.json({
      session_id: session.id,
      key_people: keyPeople.length,
      linked_kyc_spawned: spawned.length,
      unmapped_roles: unmapped,
      status: outcome?.status,
    });
  }),
);

/**
 * POST /api/v2/business/session/:id/verify-directors
 *
 * Integrator API - create verification sessions for all key people (directors)
 * who need KYC and send them their verification links via email/SMS.
 *
 * Body: {
 *   contacts?: { [key_person_id]: { email?, phone? } },
 *   send?: boolean   // false (default) only creates the sessions and returns links
 * }
 */
router.post('/session/:id/verify-directors',
  authenticateAPIKey,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const session = await loadOwnedSession(req.params.id, developerId);

    const contacts: Record<string, { email?: string | null; phone?: string | null }> = req.body?.contacts ?? {};
    const send = req.body?.send === true;
    const publicOrigin = req.body?.public_origin || process.env.FRONTEND_URL || '';

    let results;
    if (send) {
      results = await sendVerificationLinks(
        session.id,
        developerId,
        { contacts, publicOrigin },
      );
    } else {
      const sessions = await prepareDirectorVerifications(
        session.id,
        developerId,
        { publicOrigin, contacts },
      );
      results = sessions.map((s) => ({
        person_id: s.person_id,
        full_name: s.full_name,
        verification_id: s.verification_id,
        verification_url: s.verification_url,
        email: s.email,
        phone: s.phone,
      }));
    }

    res.json({
      session_id: session.id,
      total: results.length,
      results,
    });
  }),
);

/**
 * POST /api/v2/business/session/:id/document
 *
 * Integrator API - upload a company document for OCR extraction.
 * Accepts multipart/form-data with fields `document` (file) and `document_type`.
 * Returns extracted company fields AND suggested directors/people.
 */
router.post('/session/:id/document',
  authenticateAPIKey,
  upload.single('document'),
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const session = await loadOwnedSession(req.params.id, developerId);

    const documentType = req.body?.document_type;
    if (!documentType) {
      throw new ValidationError('document_type is required', 'document_type', documentType);
    }
    if (!isCompanyDocumentType(documentType)) {
      throw new ValidationError(
        `Unknown document_type. Expected one of: ${COMPANY_DOCUMENT_TYPES.join(', ')}`,
        'document_type',
        documentType,
      );
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new ValidationError('document file is required', 'document', null);

    const check = await validateFileType(file.buffer);
    if (!check.valid) {
      throw new ValidationError(
        check.reason ?? 'Unsupported file type. Upload a PDF, JPEG or PNG.',
        'document',
        check.detectedType ?? 'unknown',
      );
    }

    const ingested = await ingestCompanyDocument({
      businessSessionId: session.id,
      documentType,
      buffer: file.buffer,
      fileName: file.originalname || `${documentType}`,
      mimeType: check.detectedType ?? file.mimetype,
    });

    const tamper = assessTamperSignals(ingested.raw_text, ingested.extraction);

    const doc = await recordDocument(session.id, {
      document_type: documentType,
      file_name: file.originalname ?? null,
      file_path: ingested.file_path,
      mime_type: check.detectedType ?? file.mimetype,
      file_size: file.size ?? null,
      ocr_data: ingested.extraction.fields as Record<string, unknown>,
      ocr_confidence: ingested.extraction.overall_confidence,
      fields_expected: ingested.extraction.fields_expected,
      fields_extracted: ingested.extraction.fields_extracted,
      tamper_check_passed: ingested.ocr_succeeded ? tamper.passed : null,
      tamper_notes: ingested.ocr_succeeded ? tamper.notes : (ingested.ocr_error ?? null),
    });

    await runAndStoreCrossCheck(session.id);
    const outcome = await recomputeVerdict(session.id);

    res.status(201).json({
      session_id: session.id,
      document_id: doc.id,
      document_status: doc.status,
      ocr_succeeded: ingested.ocr_succeeded,
      fields_extracted: ingested.extraction.fields_extracted,
      fields_expected: ingested.extraction.fields_expected,
      extracted_fields: ingested.extraction.fields,
      suggested_people: ingested.extraction.people,
      warnings: ingested.extraction.warnings,
      status: outcome?.status,
      reasons: outcome?.reasons ?? [],
    });
  }),
);

// ── Hosted flow (business administrator) ───────────────────────────────────

/** GET /api/v2/business/hosted/:token - bootstrap the hosted page. */
router.get('/hosted/:token',
  basicRateLimit,
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    const [people, documents] = await Promise.all([
      getKeyPeople(session.id),
      getDocuments(session.id),
    ]);

    res.json({
      status: session.status,
      company: {
        legal_name: session.legal_name,
        registration_number: session.registration_number,
        registered_address: session.registered_address,
        ...(session.user_provided_data ?? {}),
      },
      key_people: people.map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        role_tags: p.role_tags,
        ownership_percentage: p.ownership_percentage,
        kyc_status: p.kyc_status,
        kyc_required: p.kyc_required,
        email: p.email,
        phone: p.phone,
        is_corporate: p.is_corporate,
      })),
      documents: documents.map((d: any) => ({
        document_type: d.document_type,
        status: d.status,
      })),
      required_documents: DEFAULT_REQUIRED_DOCUMENTS,
      role_tags: ROLE_TAGS.map((r) => ({ tag: r.tag, group: r.group, label: r.label })),
    });
  }),
);

/** PUT /api/v2/business/hosted/:token/company */
router.put('/hosted/:token/company',
  basicRateLimit,
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    const company = req.body?.company;
    if (!company || typeof company !== 'object') {
      throw new ValidationError('company object is required', 'company', company);
    }

    await supabase
      .from('business_sessions')
      .update({
        user_provided_data: { ...(session.user_provided_data ?? {}), ...company },
        status: session.status === 'NOT_STARTED' ? 'IN_PROGRESS' : session.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    await runAndStoreCrossCheck(session.id);
    const outcome = await recomputeVerdict(session.id);
    res.json({ status: outcome?.status, reasons: outcome?.reasons ?? [] });
  }),
);

/** PUT /api/v2/business/hosted/:token/key-people */
router.put('/hosted/:token/key-people',
  basicRateLimit,
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    const people = req.body?.key_people;
    if (!Array.isArray(people)) throw new ValidationError('key_people array is required', 'key_people', people);

    for (const p of people) {
      if (!p?.full_name) throw new ValidationError('Each key person needs a full_name', 'full_name', p?.full_name);
      if (!Array.isArray(p.role_tags) || p.role_tags.length === 0) {
        throw new ValidationError(`Key person "${p.full_name}" needs at least one role tag`, 'role_tags', p.role_tags);
      }
    }

    const { keyPeople, unmapped } = await setKeyPeople(session.id, people);
    const spawned = await spawnLinkedKyc(session.id, session.developer_id);

    // Whether this session resolves ownership is the workflow's decision.
    const settings = await settingsForSession(session);

    // Nested KYB: a corporate owner gets its own business session so the
    // chain can be walked to natural persons.
    let nested: Awaited<ReturnType<typeof spawnNestedKyb>> = { spawned: [], skipped: [] };
    if (settings.nestedOwnershipEnabled) {
      nested = await spawnNestedKyb(session.id, session.developer_id);
    }

    await runAmlScreening(session.id);
    const outcome = await recomputeVerdict(session.id);

    if (settings.nestedOwnershipEnabled) {
      await persistEffectiveOwnership(session.root_session_id ?? session.id);
    }

    res.json({
      key_people: keyPeople.length,
      linked_kyc_spawned: spawned.length,
      // Surfaced rather than swallowed: an unrecognised role is a question
      // for an analyst, not something to silently drop.
      unmapped_roles: unmapped,
      ...(settings.nestedOwnershipEnabled
        ? {
            nested_kyb_spawned: nested.spawned.length,
            // A skipped corporate owner (cycle or too deep) is a finding, not
            // a silent omission - it keeps the parent out of approval.
            nested_kyb_skipped: nested.skipped,
          }
        : {}),
      status: outcome?.status,
      ubo_kyc_summary: outcome?.ubo_kyc_summary,
      ownership_resolved: outcome?.ownership_resolved,
    });
  }),
);

/**
 * POST /api/v2/business/hosted/:token/key-people/create-sessions
 *
 * Create proper person verification sessions for all key people who need KYC.
 * Unlike the raw linked KYC spawned in `PUT /key-people`, this generates
 * full session tokens and verification URLs that can be sent to directors.
 *
 * Returns the verification sessions with URLs for each director.
 */
router.post('/hosted/:token/key-people/create-sessions',
  basicRateLimit,
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    const publicOrigin = req.body?.public_origin || req.headers.origin || process.env.FRONTEND_URL || '';

    const sessions = await prepareDirectorVerifications(
      session.id,
      session.developer_id,
      { publicOrigin },
    );

    res.json({
      count: sessions.length,
      sessions: sessions.map((s: any) => ({
        person_id: s.person_id,
        full_name: s.full_name,
        verification_id: s.verification_id,
        verification_url: s.verification_url,
        email: s.email,
        phone: s.phone,
      })),
    });
  }),
);

/**
 * POST /api/v2/business/hosted/:token/key-people/send-links
 *
 * Create verification sessions for all pending key people and send the
 * verification links via email and/or SMS/WhatsApp.
 *
 * Request body expects `contacts` - an object keyed by key_person_id with
 * optional `email` and/or `phone` for each director. If a contact is not
 * provided but the key person already has an email/phone on record, that
 * will be used.
 *
 * Returns delivery status per director, including the verification URL.
 */
router.post('/hosted/:token/key-people/send-links',
  basicRateLimit,
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    const contacts: Record<string, { email?: string | null; phone?: string | null }> = req.body?.contacts ?? {};
    const publicOrigin = req.body?.public_origin || req.headers.origin || process.env.FRONTEND_URL || '';

    if (typeof contacts !== 'object' || Array.isArray(contacts)) {
      throw new ValidationError('contacts must be an object keyed by key_person_id', 'contacts', contacts);
    }

    const results = await sendVerificationLinks(
      session.id,
      session.developer_id,
      { contacts, publicOrigin },
    );

    res.json({
      total: results.length,
      results: results.map((r: any) => ({
        person_id: r.person_id,
        full_name: r.full_name,
        email_sent: r.email_sent,
        sms_sent: r.sms_sent,
        whatsapp_sent: r.whatsapp_sent,
        verification_url: r.verification_url,
        error: r.error,
      })),
    });
  }),
);

/**
 * POST /api/v2/business/hosted/:token/document
 *
 * Accepts an actual file upload (multipart field `document`), stores it, runs
 * OCR, extracts the company fields, and re-runs the cross-check.
 *
 * Also accepts a JSON body carrying pre-extracted `ocr_data` - that path
 * exists for integrators who run their own OCR, and for tests. When a file is
 * present it always wins, because a caller-supplied field set is an assertion
 * and the document is evidence.
 */
router.post('/hosted/:token/document',
  basicRateLimit,
  upload.single('document'),
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    const documentType = req.body?.document_type;
    if (!documentType) {
      throw new ValidationError('document_type is required', 'document_type', documentType);
    }
    if (!isCompanyDocumentType(documentType)) {
      throw new ValidationError(
        `Unknown document_type. Expected one of: ${COMPANY_DOCUMENT_TYPES.join(', ')}`,
        'document_type',
        documentType,
      );
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;

    // ── File path: store, OCR, extract ──────────────────────────────────
    if (file) {
      // Trust the bytes, not the declared Content-Type - a caller can label a
      // PDF as anything, and the OCR provider would then be handed something
      // it cannot read.
      const check = await validateFileType(file.buffer);
      if (!check.valid) {
        throw new ValidationError(
          check.reason ?? 'Unsupported file type. Upload a PDF, JPEG or PNG.',
          'document',
          check.detectedType ?? 'unknown',
        );
      }

      const ingested = await ingestCompanyDocument({
        businessSessionId: session.id,
        documentType,
        buffer: file.buffer,
        fileName: file.originalname || `${documentType}`,
        mimeType: check.detectedType ?? file.mimetype,
      });

      const tamper = assessTamperSignals(ingested.raw_text, ingested.extraction);

      const doc = await recordDocument(session.id, {
        document_type: documentType,
        file_name: file.originalname ?? null,
        file_path: ingested.file_path,
        mime_type: check.detectedType ?? file.mimetype,
        file_size: file.size ?? null,
        ocr_data: ingested.extraction.fields as Record<string, unknown>,
        ocr_confidence: ingested.extraction.overall_confidence,
        fields_expected: ingested.extraction.fields_expected,
        fields_extracted: ingested.extraction.fields_extracted,
        tamper_check_passed: ingested.ocr_succeeded ? tamper.passed : null,
        tamper_notes: ingested.ocr_succeeded ? tamper.notes : (ingested.ocr_error ?? null),
      });

      await runAndStoreCrossCheck(session.id);
      const outcome = await recomputeVerdict(session.id);

      return res.status(201).json({
        document_id: doc.id,
        document_status: doc.status,
        ocr_succeeded: ingested.ocr_succeeded,
        fields_extracted: ingested.extraction.fields_extracted,
        fields_expected: ingested.extraction.fields_expected,
        extracted_fields: ingested.extraction.fields,
        // People read off a shareholder register are returned for the
        // administrator to confirm - never auto-committed as key people,
        // because a misread ownership graph is worse than a manual one.
        suggested_people: ingested.extraction.people,
        warnings: ingested.extraction.warnings,
        status: outcome?.status,
        reasons: outcome?.reasons ?? [],
      });
    }

    // ── JSON path: caller supplied their own extraction ─────────────────
    const { ocr_data, ocr_confidence, file_name, file_path, mime_type, file_size, tamper_check_passed } = req.body ?? {};

    const doc = await recordDocument(session.id, {
      document_type: documentType,
      file_name: file_name ?? null,
      file_path: file_path ?? null,
      mime_type: mime_type ?? null,
      file_size: file_size ?? null,
      ocr_data: ocr_data ?? {},
      ocr_confidence: ocr_confidence ?? null,
      fields_extracted: ocr_data ? Object.keys(ocr_data).length : 0,
      tamper_check_passed: tamper_check_passed ?? null,
    });

    await runAndStoreCrossCheck(session.id);
    const outcome = await recomputeVerdict(session.id);

    res.status(201).json({
      document_id: doc.id,
      document_status: doc.status,
      status: outcome?.status,
      reasons: outcome?.reasons ?? [],
    });
  }),
);

/** POST /api/v2/business/hosted/:token/submit */
router.post('/hosted/:token/submit',
  basicRateLimit,
  catchAsync(async (req: Request, res: Response) => {
    const session = await loadSessionByToken(req.params.token);
    await runAndStoreCrossCheck(session.id);
    await runAmlScreening(session.id);
    const outcome = await recomputeVerdict(session.id);
    res.json({
      status: outcome?.status,
      reasons: outcome?.reasons ?? [],
      ubo_kyc_summary: outcome?.ubo_kyc_summary,
    });
  }),
);

// ── Analyst / admin surface ────────────────────────────────────────────────

/** GET /api/v2/business/sessions */
router.get('/sessions',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const { status, search, page, limit, scope } = req.query;
    const result = await listBusinessSessions(developerId, {
      status: status as string | undefined,
      search: search as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      // Child sessions are hidden by default; ?scope=all includes them.
      scope: scope === 'all' ? 'all' : 'roots',
    });
    res.json(result);
  }),
);

/** GET /api/v2/business/sessions/stats */
router.get('/sessions/stats',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const { data } = await supabase
      .from('business_sessions')
      .select('status')
      .eq('developer_id', developerId);

    const rows = data ?? [];
    const count = (s: string) => rows.filter((r: any) => r.status === s).length;

    res.json({
      total: rows.length,
      awaiting_user: count('AWAITING_USER'),
      in_progress: count('IN_PROGRESS'),
      in_review: count('IN_REVIEW'),
      approved: count('APPROVED'),
      declined: count('DECLINED'),
    });
  }),
);

/** GET /api/v2/business/sessions/:id - the full review payload. */
router.get('/sessions/:id',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    await loadOwnedSession(req.params.id, developerId);
    const decision = await buildDecisionObject(req.params.id);
    res.json(decision);
  }),
);

/** POST /api/v2/business/sessions/:id/decision */
router.post('/sessions/:id/decision',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    await loadOwnedSession(req.params.id, developerId);

    const { decision, note } = req.body ?? {};
    const allowed = ['APPROVED', 'DECLINED', 'IN_REVIEW'];
    if (!allowed.includes(decision)) {
      throw new ValidationError(`decision must be one of ${allowed.join(', ')}`, 'decision', decision);
    }

    const updated = await recordDecision(req.params.id, decision, developerId, note);
    logger.info('Business verification decision recorded', {
      sessionId: req.params.id, decision, developerId,
    });
    res.json({ status: updated.status, decided_at: updated.decided_at });
  }),
);

/** POST /api/v2/business/sessions/:id/recompute - re-run checks. */
router.post('/sessions/:id/recompute',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    await loadOwnedSession(req.params.id, developerId);
    await runAndStoreCrossCheck(req.params.id);
    await runAmlScreening(req.params.id);
    const outcome = await recomputeVerdict(req.params.id);
    res.json(outcome);
  }),
);

/** GET /api/v2/business/sessions/:id/cross-checks */
router.get('/sessions/:id/cross-checks',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    await loadOwnedSession(req.params.id, developerId);
    res.json({ cross_checks: await getCrossChecks(req.params.id) });
  }),
);

// ── Workflow settings ──────────────────────────────────────────────────────

/**
 * GET /api/v2/business/workflows
 *
 * The developer's registered workflows. A workflow_id used on a session but
 * never registered simply runs on deployment defaults and will not appear.
 */
router.get('/workflows',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const workflows = await listWorkflows(developerIdFrom(req));
    res.json({
      deployment_defaults: { nested_ownership_enabled: isNestedKybEnabledByDefault() },
      workflows: workflows.map((w) => ({
        workflow_id: w.workflow_id,
        name: w.name,
        description: w.description,
        // null means "inherit" - kept distinct from false so the UI can show
        // "inherited (off)" rather than claiming the workflow chose it.
        nested_ownership_enabled: w.nested_ownership_enabled,
        auto_approve_when_clean: w.auto_approve_when_clean,
        required_documents: w.required_documents,
        ubo_threshold_percentage: w.ubo_threshold_percentage,
        is_active: w.is_active,
      })),
    });
  }),
);

/**
 * GET /api/v2/business/workflows/:workflow_id
 *
 * Both the stored settings and what they resolve to, so an operator can see
 * the effect of inheritance without working it out themselves.
 */
router.get('/workflows/:workflow_id',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const workflow = await getWorkflow(developerId, req.params.workflow_id);
    const settings = await settingsForSession({
      developer_id: developerId,
      workflow_id: req.params.workflow_id,
    });

    res.json({
      workflow_id: req.params.workflow_id,
      registered: workflow !== null,
      stored: workflow
        ? {
            name: workflow.name,
            description: workflow.description,
            nested_ownership_enabled: workflow.nested_ownership_enabled,
            auto_approve_when_clean: workflow.auto_approve_when_clean,
            required_documents: workflow.required_documents,
            ubo_threshold_percentage: workflow.ubo_threshold_percentage,
            is_active: workflow.is_active,
          }
        : null,
      effective: {
        nested_ownership_enabled: settings.nestedOwnershipEnabled,
        // 'workflow' = this workflow decided; 'deployment' = inherited.
        nested_ownership_source: settings.source.nestedOwnership,
        required_documents: settings.requiredDocuments ?? DEFAULT_REQUIRED_DOCUMENTS,
      },
    });
  }),
);

/**
 * PUT /api/v2/business/workflows/:workflow_id
 *
 * Create or update a workflow's settings. Send null for a setting to hand it
 * back to the deployment default; omit it to leave it unchanged.
 */
router.put('/workflows/:workflow_id',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const workflowId = req.params.workflow_id;

    if (!/^[\w.:-]{1,120}$/.test(workflowId)) {
      throw new ValidationError(
        'workflow_id must be 1-120 characters of letters, numbers, dot, colon, dash or underscore',
        'workflow_id', workflowId,
      );
    }

    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    // Tri-state: true/false set it, null hands it back to the default,
    // omitted leaves it alone. `in` distinguishes null from absent.
    for (const key of ['nested_ownership_enabled', 'auto_approve_when_clean'] as const) {
      if (key in body) {
        if (body[key] !== null && typeof body[key] !== 'boolean') {
          throw new ValidationError(`${key} must be true, false, or null`, key, body[key]);
        }
        patch[key] = body[key];
      }
    }

    if ('required_documents' in body) {
      const docs = body.required_documents;
      if (docs !== null && (!Array.isArray(docs) || docs.some((d: unknown) => typeof d !== 'string'))) {
        throw new ValidationError('required_documents must be an array of strings, or null', 'required_documents', docs);
      }
      patch.required_documents = docs;
    }

    if ('ubo_threshold_percentage' in body) {
      const pct = body.ubo_threshold_percentage;
      if (pct !== null && (typeof pct !== 'number' || pct <= 0 || pct > 100)) {
        throw new ValidationError(
          'ubo_threshold_percentage must be between 0 (exclusive) and 100, or null',
          'ubo_threshold_percentage', pct,
        );
      }
      patch.ubo_threshold_percentage = pct;
    }

    for (const key of ['name', 'description'] as const) {
      if (key in body) patch[key] = body[key] === null ? null : String(body[key]);
    }
    if ('is_active' in body) patch.is_active = Boolean(body.is_active);

    const saved = await upsertWorkflow(developerId, workflowId, patch);
    const settings = await settingsForSession({ developer_id: developerId, workflow_id: workflowId });

    res.json({
      workflow_id: saved.workflow_id,
      saved: true,
      // Echo the resolved result: with inheritance in play, what was stored
      // and what will happen are not always the same sentence.
      effective: {
        nested_ownership_enabled: settings.nestedOwnershipEnabled,
        nested_ownership_source: settings.source.nestedOwnership,
      },
    });
  }),
);

/**
 * GET /api/v2/business/sessions/:id/ownership
 *
 * The resolved ownership graph: who ultimately owns this company, how much of
 * it is still opaque, and each beneficial owner's effective stake through the
 * chain.
 */
router.get('/sessions/:id/ownership',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    const session = await loadOwnedSession(req.params.id, developerId);

    const settings = await settingsForSession(session);
    if (!settings.nestedOwnershipEnabled) {
      return res.json({
        enabled: false,
        // Say which layer decided, so "why is this empty?" is answerable
        // without reading config.
        disabled_by: settings.source.nestedOwnership,
        note: settings.source.nestedOwnership === 'workflow'
          ? `Workflow "${session.workflow_id}" does not resolve nested ownership. Corporate owners are recorded but not resolved.`
          : 'Nested KYB is off by default on this deployment. Corporate owners are recorded but not resolved.',
      });
    }

    const resolution = await getOwnershipResolution(session.root_session_id ?? session.id);
    res.json({ enabled: true, enabled_by: settings.source.nestedOwnership, ...resolution });
  }),
);

/** GET /api/v2/business/sessions/:id/aml */
router.get('/sessions/:id/aml',
  authenticateDeveloperJWT,
  catchAsync(async (req: Request, res: Response) => {
    const developerId = developerIdFrom(req);
    await loadOwnedSession(req.params.id, developerId);
    res.json({ screenings: await getAmlScreenings(req.params.id) });
  }),
);

export default router;
