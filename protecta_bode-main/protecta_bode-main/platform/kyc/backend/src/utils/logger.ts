import winston from 'winston';
import fs from 'fs';
import path from 'path';
import config from '@/config/index.js';
import { isRecoverablePgDisconnect } from '@/utils/pgErrors.js';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Winston's File transport calls fs.mkdirSync on its log directory from the
// constructor. In containers running as a non-root user (the compliance-stack
// image runs as `nodeuser`), an unwritable/missing `logs/` directory throws
// EACCES at *import time* - which previously crashed the whole API before it
// could bind its health-check port, marking the container unhealthy and taking
// the edge proxy down with it. Create the directory best-effort up front and
// degrade to console-only logging if file logging cannot be set up, so a log
// volume/permission problem is a warning and never a fatal startup error.
const ensureLogDir = (filename: string): boolean => {
  try {
    const dir = path.dirname(filename);
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[logger] Unable to prepare log directory for "${filename}": ${(err as Error).message}. Continuing with console logging only.`
    );
    return false;
  }
};

const fileTransport = (filename: string, options: Partial<winston.transports.FileTransportOptions> = {}): winston.transport | null => {
  if (!ensureLogDir(filename)) return null;
  try {
    return new winston.transports.File({
      filename,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      ...options
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[logger] File transport for "${filename}" unavailable: ${(err as Error).message}. Continuing with console logging only.`
    );
    return null;
  }
};

const isProduction = config.nodeEnv === 'production';

const fileTransports = isProduction
  ? [
      fileTransport('logs/error.log', { level: 'error' }),
      fileTransport('logs/combined.log')
    ].filter((t): t is winston.transport => t !== null)
  : [];

const exceptionFileTransports = isProduction
  ? [fileTransport('logs/exceptions.log')].filter(
      (t): t is winston.transport => t !== null
    )
  : [];

const rejectionFileTransports = isProduction
  ? [fileTransport('logs/rejections.log')].filter(
      (t): t is winston.transport => t !== null
    )
  : [];

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  // Winston's exceptionHandlers otherwise exit the process after logging.
  // Recoverable pg idle-disconnects must not take the API down.
  exitOnError: (err: Error) => !isRecoverablePgDisconnect(err),
  defaultMeta: {
    service: 'kabila-api',
    environment: config.nodeEnv
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: config.nodeEnv === 'development' ? consoleFormat : logFormat
    }),

    // File transports for production (best-effort; see fileTransport notes)
    ...fileTransports
  ],

  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.Console(),
    ...exceptionFileTransports
  ],

  rejectionHandlers: [
    new winston.transports.Console(),
    ...rejectionFileTransports
  ]
});

// Add request ID to logs for tracing
export const addRequestId = (req: any, res: any, next: any) => {
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

// Structured logging helpers
export const logError = (message: string, error: Error, meta: any = {}) => {
  logger.error(message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    ...meta
  });
};

export const logVerificationEvent = (event: string, verificationId: string, meta: any = {}) => {
  logger.info(`Verification ${event}`, {
    event,
    verificationId,
    ...meta
  });
};

export const logAPIRequest = (req: any, duration: number) => {
  logger.info('API Request', {
    method: req.method,
    url: req.originalUrl,
    requestId: req.requestId,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    duration: `${duration}ms`,
    apiKey: req.apiKey?.key_prefix ? `${req.apiKey.key_prefix}***` : 'none'
  });
};

export const logWebhookDelivery = (webhookId: string, status: string, meta: any = {}) => {
  logger.info('Webhook delivery', {
    webhookId,
    status,
    ...meta
  });
};

export default logger;
