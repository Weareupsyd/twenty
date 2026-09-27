import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireWritable, staffFrom } from './staffAuth.js';
import { getSubjectFile, getSubjectMedia, listSubjects, runSubjectScreening } from './subjects.js';
import { recordSubjectDecision } from './decisions.js';
import { getOverview } from './overview.js';
import { fanOutUbos, getBusinessFile, listBusinesses } from './business.js';
import { createBusinessSession } from '@/services/kyb/businessSessionService.js';
import { generateReport, getStoredReport, listReports } from './reports.js';
import rateLimit from 'express-rate-limit';
import {
  extendVerificationLink,
  findSweepCandidates,
  restoreVerification,
  sweepStaleVerifications,
  voidVerification,
} from './lifecycle.js';
import {
  HOSTED_VERIFICATION_MODES,
  createHostedSession,
  listHostedPages,
  resolveDefaultHostedDeveloperId,
  saveHostedPage,
} from './hostedPages.js';
import { validateWebhookUrl } from '@/utils/validateUrl.js';
import {
  listStaffWebhooks,
  createStaffWebhook,
  getStaffWebhookById,
  deleteStaffWebhook,
  getStaffWebhookSecret,
} from './webhooks.js';

const publicStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification starts. Please try again shortly.' },
});

const router = Router();

function sendErr(res: import('express').Response, err: unknown): void {
  const e = err as { status?: number; message?: string };
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  res.status(status).json({
    error: status === 500 ? 'Internal error' : 'Request failed',
    message: e.message || String(err),
  });
}

router.get('/phase', (_req, res) => {
  res.json({ status: 'ok', port: 'typescript', phase: 5, surface: 'combined', rehearsal: false, cutover: true });
});

/** Normalize a mount prefix like /kyc/ or /kyc -> '/kyc' ('' when root). */
function normalizePrefix(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.split(',')[0]?.trim() || '';
  if (!value.startsWith('/') || value.includes('..') || value.includes('//')) return '';
  return value.replace(/\/+$/, '');
}

function publicOrigin(req: import('express').Request): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      // Keep the path - mounted deployments set e.g. https://host/kyc and
      // .origin alone would silently drop the mount and 404 every link.
      return url.origin + normalizePrefix(url.pathname);
    } catch { /* fall through */ }
  }
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.get('host');
  const host = rawHost?.split(',')[0]?.trim();
  if (!host || !/^[a-zA-Z0-9._-]+(?::\d+)?$/.test(host)) {
    throw Object.assign(new Error('Unable to determine the public verification URL'), { status: 500 });
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = rawProto?.split(',')[0]?.trim() === 'https' ? 'https' : req.protocol === 'https' ? 'https' : 'http';
  return `${proto}://${host}` + normalizePrefix(req.headers['x-forwarded-prefix']);
}

router.get('/hosted-pages', requireStaff, async (_req, res) => {
  try {
    res.json({
      pages: await listHostedPages(),
      templates: [
        { id: 'full', mode: 'full', name: 'Full verification', description: 'Front and back of ID, liveness, face match and screening.', age_threshold: null },
        { id: 'document_only', mode: 'document_only', name: 'Document verification', description: 'Front and back document checks without a live face step.', age_threshold: null },
        { id: 'identity', mode: 'identity', name: 'Identity match', description: 'Front of ID, liveness and face match.', age_threshold: null },
        { id: 'age_18', mode: 'age_only', name: 'Age verification · 18+', description: 'Front document and date-of-birth threshold only.', age_threshold: 18 },
        { id: 'age_21', mode: 'age_only', name: 'Age verification · 21+', description: 'Front document and date-of-birth threshold only.', age_threshold: 21 },
        { id: 'company', mode: 'company', name: 'Company verification (KYB)', description: 'Company profile and constitutive documents. Directors and UBOs are auto-spawned as individual verifications, linked back to this company.', age_threshold: null },
      ],
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.put('/hosted-pages/:developerId', requireStaff, requireWritable, async (req, res) => {
  try {
    const params = z.object({ developerId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      slug: z.string().max(50).nullable().optional(),
      config: z.record(z.unknown()),
    }).parse(req.body || {});
    res.json(await saveHostedPage(params.developerId, body));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.post('/verify/staff-start', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      verification_mode: z.enum(HOSTED_VERIFICATION_MODES).optional(),
      age_threshold: z.number().int().min(1).max(99).optional(),
      developer_id: z.string().uuid().optional(),
      // KYB extras - ignored for person modes.
      workflow_id: z.string().max(120).optional().nullable(),
      vendor_data: z.string().max(255).optional().nullable(),
      company: z.record(z.unknown()).optional(),
    }).parse(req.body || {});
    const developerId = body.developer_id || await resolveDefaultHostedDeveloperId();
    const result = await createHostedSession({
      developerId,
      verificationMode: body.verification_mode,
      ageThreshold: body.age_threshold,
      workflowId: body.workflow_id ?? null,
      vendorData: body.vendor_data ?? null,
      company: body.company,
      clientIp: req.ip || null,
      publicOrigin: publicOrigin(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.post('/verify/public-start', publicStartLimiter, async (req, res) => {
  try {
    const body = z.object({
      verification_mode: z.enum(HOSTED_VERIFICATION_MODES).optional(),
      age_threshold: z.number().int().min(1).max(99).optional(),
    }).parse(req.body || {});
    const developerId = await resolveDefaultHostedDeveloperId();
    const result = await createHostedSession({
      developerId,
      verificationMode: body.verification_mode,
      ageThreshold: body.age_threshold,
      clientIp: req.ip || null,
      publicOrigin: publicOrigin(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.post('/hosted-pages/:developerId/sessions', requireStaff, requireWritable, async (req, res) => {
  try {
    const params = z.object({ developerId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      verification_mode: z.enum(HOSTED_VERIFICATION_MODES).optional(),
      age_threshold: z.number().int().min(1).max(99).optional(),
      issuing_country: z.string().length(2).optional(),
      applicant: z.object({
        email: z.string().email().optional().or(z.literal('')),
        first_name: z.string().max(100).optional(),
        last_name: z.string().max(100).optional(),
        phone: z.string().max(30).optional(),
      }).optional(),
    }).parse(req.body || {});
    const result = await createHostedSession({
      developerId: params.developerId,
      verificationMode: body.verification_mode,
      ageThreshold: body.age_threshold,
      issuingCountry: body.issuing_country,
      applicant: body.applicant ? {
        email: body.applicant.email || undefined,
        firstName: body.applicant.first_name,
        lastName: body.applicant.last_name,
        phone: body.applicant.phone,
      } : undefined,
      clientIp: req.ip || null,
      publicOrigin: publicOrigin(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.get('/overview', requireStaff, async (_req, res) => {
  try {
    res.json(await getOverview());
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/subjects', requireStaff, async (req, res) => {
  try {
    res.json(await listSubjects({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
      limit: Math.min(Number(req.query.limit) || 50, 200),
      offset: Number(req.query.offset) || 0,
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/subjects/:id/media/:mediaId', requireStaff, async (req, res) => {
  try {
    const media = await getSubjectMedia(req.params.id, req.params.mediaId);
    if (!media) {
      res.status(404).json({ error: 'Not found', message: 'Subject media not found' });
      return;
    }
    const safeName = media.filename.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', media.mime);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(media.bytes);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/subjects/:id', requireStaff, async (req, res) => {
  try {
    const file = await getSubjectFile(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'Not found', message: 'Subject not found' });
      return;
    }
    res.json(file);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/subjects/:id/screen', requireStaff, requireWritable, async (req, res) => {
  try {
    const file = await runSubjectScreening(req.params.id, staffFrom(req));
    if (!file) {
      res.status(404).json({ error: 'Not found', message: 'Subject not found' });
      return;
    }
    res.json(file);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/subjects/:id/decision', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      decision: z.string().min(3),
      reason: z.string().optional().nullable(),
      escalate_to: z.string().optional().nullable(),
      evidence: z.record(z.unknown()).optional(),
    }).parse(req.body || {});
    const result = await recordSubjectDecision({
      subjectId: req.params.id,
      decision: body.decision,
      reason: body.reason,
      escalateTo: body.escalate_to,
      evidence: body.evidence,
      staff: staffFrom(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

// ── Verification lifecycle ────────────────────────────────────────────────
// Delete (void), restore, extend an expired link, and the end-of-day sweep.
// "Delete" is a soft void: the row keeps its audit trail but leaves the live
// subject queue, which is what every overview counter is computed from.

router.delete('/verifications/:id', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      reason: z.string().max(500).optional().nullable(),
    }).parse(req.body || {});
    res.json(await voidVerification({
      id: req.params.id,
      reason: body.reason,
      staff: staffFrom(req),
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.post('/verifications/:id/restore', requireStaff, requireWritable, async (req, res) => {
  try {
    res.json(await restoreVerification({ id: req.params.id, staff: staffFrom(req) }));
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/verifications/:id/extend', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      hours: z.number().int().min(1).max(168).optional(),
    }).parse(req.body || {});
    res.json(await extendVerificationLink({
      id: req.params.id,
      windowMs: body.hours ? body.hours * 60 * 60 * 1000 : undefined,
      staff: staffFrom(req),
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

/** Preview what tonight's sweep would remove, without touching anything. */
router.get('/verifications/sweep/preview', requireStaff, async (req, res) => {
  try {
    const staleHours = req.query.stale_hours ? Number(req.query.stale_hours) : undefined;
    const candidates = await findSweepCandidates({
      staleHours: Number.isFinite(staleHours) ? staleHours : undefined,
    });
    res.json({
      total: candidates.length,
      expired: candidates.filter((c) => c.reason === 'expired').length,
      stale: candidates.filter((c) => c.reason === 'stale').length,
      items: candidates.slice(0, 100),
    });
  } catch (err) {
    sendErr(res, err);
  }
});

/** Run the sweep on demand. Same code path the nightly cron uses. */
router.post('/verifications/sweep', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      stale_hours: z.number().int().min(1).max(8760).optional(),
      dry_run: z.boolean().optional(),
    }).parse(req.body || {});
    const staff = staffFrom(req);
    res.json(await sweepStaleVerifications({
      staleHours: body.stale_hours,
      dryRun: body.dry_run,
      actor: staff.email || staff.id,
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.get('/businesses', requireStaff, async (req, res) => {
  try {
    res.json(await listBusinesses({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      limit: Math.min(Number(req.query.limit) || 50, 200),
      offset: Number(req.query.offset) || 0,
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/business/:id', requireStaff, async (req, res) => {
  try {
    const file = await getBusinessFile(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'Not found', message: 'Business not found' });
      return;
    }
    res.json(file);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/business/:id/ubo-fanout', requireStaff, requireWritable, async (req, res) => {
  try {
    res.status(201).json(await fanOutUbos(req.params.id, staffFrom(req)));
  } catch (err) {
    sendErr(res, err);
  }
});

/**
 * POST /api/business/start
 *
 * Staff-console counterpart to POST /api/v2/business/session - that endpoint
 * requires a developer API key and is meant for integrator traffic. This one
 * uses the staff session already established for /app/, resolves the default
 * hosted developer (same choice as /verify/staff-start), then delegates to the
 * KYB service.
 *
 * Body fields are all optional. When the operator only clicks the button, we
 * still get a valid NOT_STARTED session with a hosted URL to hand to the
 * company; anything they type is stored in user_provided_data so the
 * cross-check has something to compare the uploaded documents against.
 */
router.post('/business/start', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      workflow_id: z.string().max(120).optional().nullable(),
      vendor_data: z.string().max(255).optional().nullable(),
      developer_id: z.string().uuid().optional(),
      company: z.object({
        legal_name: z.string().max(255).optional(),
        registration_number: z.string().max(120).optional(),
        jurisdiction: z.string().max(120).optional(),
        registered_address: z.string().max(500).optional(),
        company_type: z.string().max(120).optional(),
        tax_number: z.string().max(120).optional(),
      }).partial().optional(),
    }).parse(req.body || {});

    const developerId = body.developer_id || await resolveDefaultHostedDeveloperId();
    const { session, accessToken } = await createBusinessSession({
      developerId,
      workflowId: body.workflow_id ?? null,
      vendorData: body.vendor_data ?? null,
      userProvidedData: body.company ?? {},
    });

    const origin = publicOrigin(req);
    res.status(201).json({
      session_id: session.id,
      business_session_id: session.id,
      session_kind: 'business',
      session_number: session.session_number,
      status: session.status,
      workflow_id: session.workflow_id,
      vendor_data: session.vendor_data,
      hosted_url: `${origin}/b/${accessToken}`,
      expires_at: session.access_token_expires_at,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.get('/reports', requireStaff, async (_req, res) => {
  try {
    res.json(await listReports());
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/reports/coverage', requireStaff, async (_req, res) => {
  try {
    const { coverageAttestation } = await import('../aml/coverage.js');
    res.json(await coverageAttestation());
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/migration/status', requireStaff, async (_req, res) => {
  try {
    const { runBackfill } = await import('./backfill.js');
    res.json(await runBackfill(false));
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/migration/backfill', requireStaff, requireWritable, async (req, res) => {
  try {
    const apply = req.body?.apply === true || req.query.apply === 'true';
    const { runBackfill } = await import('./backfill.js');
    res.json(await runBackfill(apply));
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/reports/generate', requireStaff, requireWritable, async (req, res) => {
  try {
    const body = z.object({
      type: z.string().min(2),
      subject_id: z.string().optional(),
    }).parse(req.body || {});
    const report = await generateReport({
      type: body.type,
      subjectId: body.subject_id,
      staff: staffFrom(req),
    });
    res.setHeader('Content-Type', report.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.setHeader('X-Report-Id', report.id);
    res.setHeader('X-Report-Ref', report.ref);
    res.send(report.bytes);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.get('/reports/:id', requireStaff, async (req, res) => {
  try {
    const stored = await getStoredReport(req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'Not found', message: 'Report not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${stored.filename}"`);
    res.send(stored.bytes);
  } catch (err) {
    sendErr(res, err);
  }
});

// ── AML webhooks (staff-owned) ────────────────────────────────────────────
// These are separate from developer webhooks: they are owned by
// compliance.staff, not public.developers, so they never hit
// webhooks_developer_id_fkey. Migration 68 makes developer_id nullable and
// adds compliance_staff_id.
//
// Mounted as /api/compliance/webhooks (primary) and /api/aml/webhooks (alias)
// to avoid colliding with legacy /api/webhooks (developer-owned).
// Frontend AML console should call /api/compliance/webhooks.

async function handleListStaffWebhooks(req: import('express').Request, res: import('express').Response) {
  try {
    const staff = staffFrom(req);
    const webhooks = await listStaffWebhooks(staff.id);
    const masked = webhooks.map((w: any) => ({
      id: w.id,
      url: w.url,
      is_sandbox: w.is_sandbox,
      is_active: w.is_active,
      created_at: w.created_at,
      events: w.events,
      owner_type: w.owner_type,
      secret_key: w.secret_key
        ? `${w.secret_key.slice(0, 6)}${'*'.repeat(8)}${w.secret_key.slice(-4)}`
        : null,
    }));
    res.json({ webhooks: masked });
  } catch (err) {
    sendErr(res, err);
  }
}

async function handleCreateStaffWebhook(req: import('express').Request, res: import('express').Response) {
  try {
    const staff = staffFrom(req);
    const body = z.object({
      url: z.string().url(),
      is_sandbox: z.boolean().optional(),
      events: z.array(z.string()).optional(),
      secret: z.string().min(16).max(512).optional(),
    }).parse(req.body || {});

    try {
      await validateWebhookUrl(body.url);
    } catch (e: any) {
      res.status(400).json({ error: 'Invalid webhook URL', message: e.message });
      return;
    }

    const webhook = await createStaffWebhook({
      staffId: staff.id,
      url: body.url,
      is_sandbox: body.is_sandbox ?? false,
      events: body.events,
      secret: body.secret,
    });

    res.status(201).json({
      webhook: {
        id: webhook.id,
        url: webhook.url,
        is_sandbox: webhook.is_sandbox,
        is_active: webhook.is_active,
        created_at: webhook.created_at,
        events: webhook.events,
        owner_type: webhook.owner_type,
        secret_key: webhook.secret_key, // one-time full secret
      },
      message: 'AML webhook created. Store your signing secret securely.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
}

async function handleGetStaffWebhookSecret(req: import('express').Request, res: import('express').Response) {
  try {
    const staff = staffFrom(req);
    const params = z.object({ webhookId: z.string().uuid() }).parse(req.params);
    const secret = await getStaffWebhookSecret(staff.id, params.webhookId);
    if (!secret) {
      res.status(404).json({ error: 'Not found', message: 'Webhook or secret not found' });
      return;
    }
    res.json({ secret_key: secret });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
}

async function handleDeleteStaffWebhook(req: import('express').Request, res: import('express').Response) {
  try {
    const staff = staffFrom(req);
    const params = z.object({ webhookId: z.string().uuid() }).parse(req.params);
    const existing = await getStaffWebhookById(staff.id, params.webhookId);
    if (!existing) {
      res.status(404).json({ error: 'Not found', message: 'Webhook not found' });
      return;
    }
    await deleteStaffWebhook(staff.id, params.webhookId);
    res.json({ message: 'Webhook deleted successfully' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
}

router.get('/compliance/webhooks', requireStaff, handleListStaffWebhooks);
router.post('/compliance/webhooks', requireStaff, requireWritable, handleCreateStaffWebhook);
router.get('/compliance/webhooks/:webhookId/secret', requireStaff, handleGetStaffWebhookSecret);
router.delete('/compliance/webhooks/:webhookId', requireStaff, requireWritable, handleDeleteStaffWebhook);

// Aliases under /aml/webhooks for AML console (same handlers)
router.get('/aml/webhooks', requireStaff, handleListStaffWebhooks);
router.post('/aml/webhooks', requireStaff, requireWritable, handleCreateStaffWebhook);
router.get('/aml/webhooks/:webhookId/secret', requireStaff, handleGetStaffWebhookSecret);
router.delete('/aml/webhooks/:webhookId', requireStaff, requireWritable, handleDeleteStaffWebhook);

// Back-compat: also expose as /webhooks when mounted under /api/compliance
// (i.e., /api/compliance/webhooks already covered) - but keep old /webhooks
// guarded so legacy /api/webhooks (developer) is not shadowed. If compliance
// routes are mounted at /api, /api/webhooks would collide; we intentionally
// do NOT register /webhooks here to avoid that collision. The explicit
// /compliance/webhooks and /aml/webhooks paths are the canonical ones.

export default router;
