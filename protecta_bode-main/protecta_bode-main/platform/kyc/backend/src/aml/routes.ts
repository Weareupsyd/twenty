import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Router } from 'express';
import { z } from 'zod';
import { requireAmlAccess, requireAmlAdmin } from './auth.js';
import { ScreenRequestSchema } from './yente.js';
import { getScreen, listScreenings, runBulkScreen, runScreen } from './screen.js';
import { addNote, createCase, getCase, listCases, updateCaseStatus } from './cases.js';
import { entityDetail, entityNetwork, entitySearch } from './entity.js';
import {
  listDatasetFiles,
  listDatasets,
  storedDatasetFile,
  syncProgress,
  triggerFileSync,
  triggerSyncAll,
} from './datasets.js';
import { generateScreenReport, generateScreenReportHtml } from './report.js';
import { coverageAttestation } from './coverage.js';
import { loadSettings, saveSettings } from './settings.js';

const router = Router();

function sendErr(res: import('express').Response, err: unknown): void {
  const e = err as { status?: number; message?: string };
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  res.status(status).json({ error: status === 500 ? 'Internal error' : 'Request failed', message: e.message || String(err) });
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: 'typescript', phase: 5 });
});

router.post('/screen', requireAmlAccess, async (req, res) => {
  try {
    const payload = ScreenRequestSchema.parse(req.body);
    const result = await runScreen(payload);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err instanceof Error && err.message.includes('yente')
      ? Object.assign(err, { status: 502 })
      : err);
  }
});

router.post('/screen/bulk', requireAmlAccess, async (req, res) => {
  try {
    const body = z.object({
      entities: z.array(ScreenRequestSchema).min(1).max(1000),
      threshold: z.number().min(0.5).max(1).optional(),
    }).parse(req.body);
    const result = await runBulkScreen(body.entities, body.threshold);
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.post('/screen/person', requireAmlAccess, async (req, res) => {
  try {
    const payload = ScreenRequestSchema.parse({ ...req.body, entity_type: 'person' });
    res.json(await runScreen(payload));
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/screen/company', requireAmlAccess, async (req, res) => {
  try {
    const payload = ScreenRequestSchema.parse({ ...req.body, entity_type: 'company' });
    res.json(await runScreen(payload));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/screen/:reference/print', requireAmlAccess, async (req, res) => {
  try {
    const { html, filename } = await generateScreenReportHtml(req.params.reference);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/screen/:reference/report', requireAmlAdmin, async (req, res) => {
  try {
    const { bytes, filename } = await generateScreenReport(req.params.reference);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/screen/:reference/report', requireAmlAdmin, async (req, res) => {
  try {
    const { bytes, filename } = await generateScreenReport(req.params.reference);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/screen/:reference', requireAmlAccess, async (req, res) => {
  try {
    const result = await getScreen(req.params.reference);
    if (!result) {
      res.status(404).json({ error: 'Not found', message: 'Screening not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/screenings', requireAmlAccess, async (req, res) => {
  try {
    const result = await listScreenings({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      limit: Math.min(Number(req.query.limit) || 50, 200),
      offset: Number(req.query.offset) || 0,
    });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/cases', requireAmlAdmin, async (req, res) => {
  try {
    const payload = z.object({
      title: z.string().min(2).max(512),
      description: z.string().optional().nullable(),
      screening_reference: z.string().optional().nullable(),
    }).parse(req.body);
    const amlAuth = (req as unknown as { amlAuth?: { email?: string } }).amlAuth;
    res.status(201).json(await createCase({ ...payload, created_by: amlAuth?.email ?? null }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.get('/cases', requireAmlAccess, async (req, res) => {
  try {
    res.json(await listCases(typeof req.query.status === 'string' ? req.query.status : undefined));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/cases/:id/export', requireAmlAdmin, async (req, res) => {
  try {
    const c = await getCase(req.params.id);
    if (!c) {
      res.status(404).json({ error: 'Not found', message: 'Case not found' });
      return;
    }
    res.json({ case: c, exported_at: new Date().toISOString(), disclaimer: 'Verify all evidence before dissemination.' });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/cases/:id', requireAmlAccess, async (req, res) => {
  try {
    const c = await getCase(req.params.id);
    if (!c) {
      res.status(404).json({ error: 'Not found', message: 'Case not found' });
      return;
    }
    res.json(c);
  } catch (err) {
    sendErr(res, err);
  }
});

router.patch('/cases/:id', requireAmlAdmin, async (req, res) => {
  try {
    const { status } = z.object({ status: z.enum(['open', 'in_progress', 'closed']) }).parse(req.body);
    res.json(await updateCaseStatus(req.params.id, status));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.post('/cases/:id/notes', requireAmlAdmin, async (req, res) => {
  try {
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
    res.status(201).json(await addNote(req.params.id, content));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/entity/search', requireAmlAccess, async (req, res) => {
  try {
    const q = String(req.query.q || '');
    if (q.length < 2) {
      res.status(422).json({ error: 'q must be at least 2 characters' });
      return;
    }
    res.json(await entitySearch(q, {
      schema: typeof req.query.schema === 'string' ? req.query.schema : undefined,
      country: typeof req.query.country === 'string' ? req.query.country : undefined,
      limit: Math.min(Number(req.query.limit) || 20, 100),
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/entity/:id/network', requireAmlAccess, async (req, res) => {
  try {
    res.json(await entityNetwork(req.params.id));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/entity/:id', requireAmlAccess, async (req, res) => {
  try {
    res.json(await entityDetail(req.params.id));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/datasets', requireAmlAccess, async (_req, res) => {
  try {
    res.json(await listDatasets());
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/datasets/files', requireAmlAccess, async (_req, res) => {
  try {
    res.json(await listDatasetFiles());
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/datasets/sync/progress', requireAmlAccess, async (_req, res) => {
  try {
    res.json(await syncProgress());
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/datasets/sync', requireAmlAdmin, async (_req, res) => {
  try {
    res.json(await triggerSyncAll());
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/datasets/files/:fileName/sync', requireAmlAdmin, async (req, res) => {
  try {
    res.json(await triggerFileSync(req.params.fileName));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/datasets/files/:fileName', requireAmlAccess, async (req, res) => {
  try {
    const file = await storedDatasetFile(req.params.fileName);
    if (!file) {
      res.status(404).json({ error: 'Not found', message: 'File not downloaded yet. Trigger a dataset sync first.' });
      return;
    }
    const isGz = file.name.endsWith('.gz');
    const downloadName = isGz ? file.name.slice(0, -3) : file.name;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'no-store');
    // Stored files may be gzip-compressed to save disk - decompress on the way out.
    if (isGz) {
      await pipeline(createReadStream(file.path), createGunzip(), res).catch((err) => {
        if (!res.headersSent) sendErr(res, err);
      });
    } else {
      createReadStream(file.path).pipe(res);
    }
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/settings', requireAmlAdmin, async (_req, res) => {
  try {
    res.json(await loadSettings());
  } catch (err) {
    sendErr(res, err);
  }
});

router.put('/settings', requireAmlAdmin, async (req, res) => {
  try {
    const body = z.object({
      global_threshold: z.number().min(0.5).max(1).optional(),
      overrides: z.array(z.object({
        country: z.string().min(2).max(8),
        threshold: z.number().min(0.5).max(1),
      })).optional(),
    }).parse(req.body || {});
    res.json(await saveSettings(body));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.flatten() });
      return;
    }
    sendErr(res, err);
  }
});

router.get('/reports/coverage', requireAmlAdmin, async (_req, res) => {
  try {
    res.json(await coverageAttestation());
  } catch (err) {
    sendErr(res, err);
  }
});

export default router;
