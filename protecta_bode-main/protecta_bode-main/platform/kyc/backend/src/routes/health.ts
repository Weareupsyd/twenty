import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '@/config/database.js';
import config from '@/config/index.js';
import { catchAsync } from '@/middleware/errorHandler.js';
import { APP_VERSION } from '@/utils/version.js';

const router = express.Router();

// Basic liveness check - dependency readiness is /ready, used by Compose.
router.get('/', catchAsync(async (req: Request, res: Response) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    version: APP_VERSION
  };
  
  res.status(200).json(healthcheck);
}));

// Check the schema used by first-run setup and verification initialization.
// SELECT id alone hid missing columns (e.g. addons) behind a green health check
// while /initialize returned 500. Explicit projections validate those columns
// even on empty tables; LIMIT 0 avoids reading any subject data or token hashes.
// Bound the HTTP response even if a driver/backend stalls. The pg adapter also
// has connection/statement timeouts so timed-out probes eventually release slots.
const READINESS_PROBES: Record<string, string> = {
  users: 'id',
  developers: 'id',
  api_keys: 'id',
  verification_requests: [
    'id', 'user_id', 'developer_id', 'status', 'ocr_data', 'is_sandbox', 'source', 'addons',
    'session_started_at', 'verification_mode', 'age_threshold', 'client_ip',
    'step_timestamps', 'api_key_id', 'manual_review_reason',
    'external_reference', 'external_system', 'subject_type', 'external_user_id',
    'odoo_partner_id', 'odoo_guarantor_id', 'odoo_lead_id',
    'session_token_hash', 'session_token_expires_at', 'session_api_key_id',
  ].join(','),
  mobile_handoff_sessions: 'id',
  verification_contexts: 'verification_id,context,updated_at',
};
const DATABASE_PROBE_TIMEOUT_MS = 5000;

async function databaseReady(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(Object.entries(READINESS_PROBES).map(([table, columns]) =>
        supabase.from(table).select(columns).limit(0)
      )).then(results => results.every(result => !result.error)),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), DATABASE_PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Detailed health check with database
router.get('/detailed', catchAsync(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  // Check database connection
  let dbStatus = 'down';
  let dbLatency = 0;
  
  try {
    const dbStart = Date.now();
    if (await databaseReady()) {
      dbStatus = 'up';
      dbLatency = Date.now() - dbStart;
    }
  } catch (error) {
    dbStatus = 'error';
  }
  
  // Check external services (if configured)
  const externalServices = {
    tesseract: config.ocr.tesseractPath ? 'configured' : 'not_configured',
    persona: config.externalApis.persona ? 'configured' : 'not_configured',
    onfido: config.externalApis.onfido ? 'configured' : 'not_configured'
  };
  
  const healthcheck = {
    status: dbStatus === 'up' ? 'healthy' : 'unhealthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    version: APP_VERSION,
    responseTime: Date.now() - startTime,
    services: {
      database: {
        status: dbStatus,
        latency: dbLatency
      },
      storage: {
        provider: config.storage.provider,
        status: 'unknown' // Would need specific checks per provider
      },
      externalServices
    },
    features: {
      sandboxMode: config.sandbox.enabled,
      mockVerification: config.sandbox.mockVerification,
      gdprCompliance: config.compliance.gdprCompliance,
      rateLimiting: true
    },
    memory: {
      used: process.memoryUsage().heapUsed / 1024 / 1024,
      total: process.memoryUsage().heapTotal / 1024 / 1024,
      external: process.memoryUsage().external / 1024 / 1024
    }
  };
  
  const statusCode = healthcheck.status === 'healthy' ? 200 : 503;
  res.setHeader('Cache-Control', 'no-store');
  res.status(statusCode).json(healthcheck);
}));

// Ready check (for Kubernetes readiness probe)
router.get('/ready', catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (await databaseReady()) {
    res.status(200).json({ status: 'ready' });
  } else {
    // Do not expose database credentials, hostnames, or driver errors.
    res.status(503).json({ status: 'not_ready', error: 'Database not available' });
  }
}));

// Live check (for Kubernetes liveness probe)
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

// API Key diagnostic endpoint
router.get('/api-key-diagnostic', catchAsync(async (req: Request, res: Response) => {
  const testApiKey = req.query.key as string;
  
  if (!testApiKey) {
    return res.status(400).json({ error: 'Please provide test API key as query parameter: ?key=ik_...' });
  }
  
  const keyPrefix = testApiKey.substring(0, 8);
  const keyHash = crypto
    .createHmac('sha256', config.apiKeySecret)
    .update(testApiKey)
    .digest('hex');
  
  try {
    // Check if API key exists in database
    const { data: apiKeyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select(`
        *,
        developer:developers(*)
      `)
      .eq('key_hash', keyHash)
      .single();
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      testKey: {
        prefix: keyPrefix,
        hash: keyHash,
        found: !!apiKeyRecord,
        isActive: apiKeyRecord?.is_active || false,
        isSandbox: apiKeyRecord?.is_sandbox || false,
        expiresAt: apiKeyRecord?.expires_at || null,
        lastUsedAt: apiKeyRecord?.last_used_at || null,
        developerId: apiKeyRecord?.developer_id || null,
        developerEmail: apiKeyRecord?.developer?.email || null
      },
      environment: {
        NODE_ENV: config.nodeEnv,
        API_KEY_SECRET: config.apiKeySecret.substring(0, 8) + '...',
        DATABASE_URL_SET: !!process.env.DATABASE_URL,
        SUPABASE_URL_SET: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY_SET: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      database: {
        connected: !keyError || keyError.code !== 'PGRST301', // Connection error
        error: keyError ? {
          code: keyError.code,
          message: keyError.message,
          details: keyError.details
        } : null
      }
    };
    
    const statusCode = apiKeyRecord ? 200 : 404;
    res.status(statusCode).json(diagnostics);
    
  } catch (error: any) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      error: 'Diagnostic failed',
      details: error.message,
      environment: {
        NODE_ENV: config.nodeEnv,
        API_KEY_SECRET: config.apiKeySecret.substring(0, 8) + '...'
      }
    });
  }
}));

export default router;